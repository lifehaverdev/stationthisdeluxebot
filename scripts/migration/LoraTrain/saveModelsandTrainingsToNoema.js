// require('dotenv').config();
const { MongoClient } = require('mongodb');
const { transformLegacyLoras } = require('./transformLoraData');

const NOEMA_DATABASE_NAME = 'noema';
const mongoUri = process.env.MONGO_PASS;

async function saveMigratedLoras() {
  if (!mongoUri) {
    console.error('❌ MONGO_PASS not set in environment.');
    process.exit(1);
  }

  const client = new MongoClient(mongoUri);

  try {
    const { loraModels, loraTrainings } = await transformLegacyLoras();

    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db(NOEMA_DATABASE_NAME);
    const loraModelCollection = db.collection('loraModels');
    const trainingCollection = db.collection('loraTrainings');
    const trainFiles = db.collection('trainImages.files');
    const trainChunks = db.collection('trainImages.chunks');

    // 🔥 Wipe target collections
    console.log('🧹 Deleting existing migrated collections...');
    await Promise.all([
      loraModelCollection.deleteMany({}),
      trainingCollection.deleteMany({}),
      trainFiles.deleteMany({}),
      trainChunks.deleteMany({})
    ]);
    console.log('🧽 Cleared old data');

    // 🧠 Insert transformed data
    const modelInsertResult = await loraModelCollection.insertMany(loraModels);
    const trainingInsertResult = await trainingCollection.insertMany(loraTrainings);
    console.log(`📦 Inserted ${modelInsertResult.insertedCount} models`);
    console.log(`📦 Inserted ${trainingInsertResult.insertedCount} training jobs`);

    // 📁 Copy image files from legacy GridFS buckets to new
    const legacyFiles = db.collection('loraImages.files');
    const legacyChunks = db.collection('loraImages.chunks');
    const fsFiles = db.collection('fs.files');
    const fsChunks = db.collection('fs.chunks');

    console.log('📤 Migrating GridFS image data...');
    const fileDocs = await Promise.all([
      legacyFiles.find().toArray(),
      fsFiles.find().toArray()
    ]);
    const chunkDocs = await Promise.all([
      legacyChunks.find().toArray(),
      fsChunks.find().toArray()
    ]);

    const allFiles = [...fileDocs[0], ...fileDocs[1]];
    const allChunks = [...chunkDocs[0], ...chunkDocs[1]];

    if (allFiles.length > 0) {
      await trainFiles.insertMany(allFiles);
      console.log(`🖼️ Copied ${allFiles.length} image file entries`);
    }

    if (allChunks.length > 0) {
      await trainChunks.insertMany(allChunks);
      console.log(`🧩 Copied ${allChunks.length} image chunk entries`);
    }

    // 🔗 Remap image references in training data
    await remapTrainingImageRefs(db, trainingCollection);

    console.log(`🎉 Migration complete with models, trainings, and images`);

  } catch (err) {
    console.error('❌ Error during migration:', err);
  } finally {
    await client.close();
    console.log('🔒 MongoDB connection closed.');
  }
}

async function remapTrainingImageRefs(db, trainingCollection) {
  const trainFiles = db.collection('trainImages.files');
  const trainChunks = db.collection('trainImages.chunks');
  const legacySources = [
    db.collection('fs.files'),
    db.collection('loraImages.files')
  ];
  const legacyChunks = [
    db.collection('fs.chunks'),
    db.collection('loraImages.chunks')
  ];

  const trainings = await trainingCollection.find({}).toArray();
  for (const training of trainings) {
    const newImageIds = [];

    for (const oldId of training.images || []) {
      let fileDoc = null, chunks = [];

      for (let i = 0; i < legacySources.length; i++) {
        fileDoc = await legacySources[i].findOne({ _id: oldId });
        if (fileDoc) {
          chunks = await legacyChunks[i].find({ files_id: oldId }).toArray();
          break;
        }
      }

      if (!fileDoc || chunks.length === 0) {
        console.warn(`⚠️ Could not find image or chunks for ${oldId}`);
        continue;
      }

      // Remove original _id so Mongo can generate a new one
      const { _id, ...fileData } = fileDoc;
      const newFileResult = await trainFiles.insertOne(fileData);
      const newFileId = newFileResult.insertedId;

      const remappedChunks = chunks.map(({ _id, files_id, ...rest }) => ({
        files_id: newFileId,
        ...rest
      }));
      await trainChunks.insertMany(remappedChunks);

      newImageIds.push(newFileId);
    }

    await trainingCollection.updateOne(
      { _id: training._id },
      { $set: { images: newImageIds } }
    );
  }

  console.log(`🔗 Updated image references in ${trainings.length} trainings`);
}


saveMigratedLoras();
