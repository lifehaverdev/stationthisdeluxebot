require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

const dbName = 'stationthisbot';
const mongoUri = process.env.MONGO_PASS;

function inferType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function buildSchema(documents) {
  const schema = {};

  for (const doc of documents) {
    for (const [key, value] of Object.entries(doc)) {
      const type = inferType(value);
      if (!schema[key]) {
        schema[key] = new Set();
      }
      schema[key].add(type);
    }
  }

  return Object.entries(schema).reduce((acc, [key, types]) => {
    acc[key] = Array.from(types);
    return acc;
  }, {});
}

async function getGridFSStatsByLoraId(trainingData, db) {
    const bucketFiles = db.collection('loraImages.files');
    const defaultFsFiles = db.collection('fs.files');
    const gridfsStats = {};
  
    for (const entry of trainingData) {
      const { loraId, images } = entry;
  
      if (!gridfsStats[loraId]) {
        gridfsStats[loraId] = {
          image_count: 0,
          total_size_kb: 0,
          total_valid_references: 0,
          missing_image_ids_count: 0,
          empty_string_references: 0,
          invalid_format_references: 0,
          _temp_found_ids: [],
          _temp_missing_ids: []
        };
      }
  
      if (!Array.isArray(images)) {
        continue;
      }

      for (const imgId of images) {
        try {
          let idToCheck = imgId;
          if (imgId && (imgId instanceof ObjectId || (imgId._bsontype && imgId._bsontype === 'ObjectId'))) {
            idToCheck = imgId.toString();
          }
  
          if (typeof idToCheck === 'string' && idToCheck === '') {
            gridfsStats[loraId].empty_string_references++;
            continue;
          }
  
          if (typeof idToCheck !== 'string' || !ObjectId.isValid(idToCheck)) {
            gridfsStats[loraId].invalid_format_references++;
            continue;
          }
  
          gridfsStats[loraId].total_valid_references++;
          const fileId = new ObjectId(idToCheck);
          let fileDoc = await bucketFiles.findOne({ _id: fileId });

          if (!fileDoc) {
            fileDoc = await defaultFsFiles.findOne({ _id: fileId });
          }
  
          if (fileDoc) {
            gridfsStats[loraId]._temp_found_ids.push(idToCheck);
            gridfsStats[loraId].total_size_kb += Math.round(fileDoc.length / 1024);
          } else {
            gridfsStats[loraId]._temp_missing_ids.push(idToCheck);
          }
          
        } catch (err) {
          console.warn(`Error processing imgId '${imgId}' for loraId ${loraId}: ${err.message}`);
          gridfsStats[loraId].invalid_format_references++;
          continue;
        }
      }
    }
  
    for (const loraIdKey in gridfsStats) {
      const stats = gridfsStats[loraIdKey];
      stats.image_count = stats._temp_found_ids.length;
      stats.missing_image_ids_count = stats._temp_missing_ids.length;
      stats.avg_size_kb = stats.image_count ? Math.round(stats.total_size_kb / stats.image_count) : 0;
      delete stats._temp_found_ids;
      delete stats._temp_missing_ids;
    }
  
    return gridfsStats;
  }

async function fetchLegacyLoraData() {
  if (!mongoUri || !dbName) {
    throw new Error('Missing MONGO_PASS or BOT_NAME environment variable.');
  }

  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    const db = client.db(dbName);

    const loraRaw = await db.collection('loras').find({}).toArray();
    const trainingRaw = await db.collection('trains').find({}).toArray();

    console.log(`✅ Loaded ${loraRaw.length} legacy LoRA models and ${trainingRaw.length} training entries from '${dbName}'`);

    const loraSchema = buildSchema(loraRaw);
    const trainSchema = buildSchema(trainingRaw);

    console.log('\n📘 Legacy LoRA Schema Overview:\n');
    console.dir(loraSchema, { depth: null, colors: true });

    console.log('\n📙 Legacy Training Schema Overview:\n');
    console.dir(trainSchema, { depth: null, colors: true });

    // === Analyze GridFS Files ===
    const files = await db.collection('loraImages.files').find({}).toArray();

    const fileMap = new Map();
    for (const file of files) {
      fileMap.set(file._id.toString(), file);
    }

    const gridfsStats = await getGridFSStatsByLoraId(trainingRaw, db);

    const uniqueLoraIdsInTraining = new Set(trainingRaw.map(t => t.loraId.toString()));
    console.log(`\nℹ️ Found ${uniqueLoraIdsInTraining.size} unique loraIds in ${trainingRaw.length} training entries.`);
    console.log(`ℹ️ GridFS Image Statistics object has ${Object.keys(gridfsStats).length} keys (all unique loraIds from training data are represented).`);

    console.log('\n📦 GridFS Image Statistics (by loraId - condensed):\n');
    for (const loraIdKey in gridfsStats) {
      const stats = gridfsStats[loraIdKey];
      let avgSizeDisplay = 'N/A';
      if (stats.image_count > 0) {
        avgSizeDisplay = `${stats.avg_size_kb} KB`;
      }
      console.log(
        `LoraID: ${loraIdKey} -> ` +
        `Images: ${stats.image_count}/${stats.total_valid_references} ` +
        `(Found: ${stats.image_count}, Missing: ${stats.missing_image_ids_count}, Empty: ${stats.empty_string_references}, Invalid: ${stats.invalid_format_references}) | ` +
        `Total Size: ${stats.total_size_kb} KB | ` +
        `Avg Size: ${avgSizeDisplay}`
      );
    }

    // === Diagnostics ===
    console.log('\n🧪 Running data integrity diagnostics...\n');

    // Fetch IDs from both loraImages.files and fs.files for a comprehensive check for missingGridFS
    const loraImageFileIdDocs = await db.collection('loraImages.files').find({}, { projection: { _id: 1 } }).toArray();
    const defaultFsFileIdDocs = await db.collection('fs.files').find({}, { projection: { _id: 1 } }).toArray();

    const combinedAvailableGridFSIds = new Set();
    loraImageFileIdDocs.forEach(doc => combinedAvailableGridFSIds.add(doc._id.toString()));
    defaultFsFileIdDocs.forEach(doc => {
      // Add to combined set only if not already present from loraImages.files to correctly count distinct files later if needed
      // For missingGridFS, simple add is fine as Set handles duplicates.
      combinedAvailableGridFSIds.add(doc._id.toString());
    });

    const issues = {
      missingCaptions: 0,
      missingImagesInTrain: 0,
      mismatchedCaptionImageCounts: 0,
      orphanedGridFS: 0,
      missingGridFS: 0,
      invalidObjectIdFormat: 0,
      emptyImageIdStrings: 0,
      filesMissingChunks: 0,
      chunksMissingFileEntry: 0,
    };

    const gridfsIds = new Set(files.map(f => f._id.toString()));

    for (const train of trainingRaw) {
      const { captions, images, loraId } = train;

      if (!captions || captions.length === 0 || captions.every(c => c === '')) {
        issues.missingCaptions++;
      }

      if (!images || images.length === 0) {
        issues.missingImagesInTrain++;
        continue;
      }

      if (images.length !== captions.length) {
        issues.mismatchedCaptionImageCounts++;
      }

      for (const imgId of images) {
        let idForDiag = imgId;
        if (imgId && (imgId instanceof ObjectId || imgId._bsontype === 'ObjectId')) {
          idForDiag = imgId.toString();
        }

        if (typeof idForDiag === 'string' && idForDiag === '') {
          issues.emptyImageIdStrings++;
          continue;
        }

        if (typeof idForDiag !== 'string' || !ObjectId.isValid(idForDiag)) {
          issues.invalidObjectIdFormat++;
          // console.warn(`Invalid format or non-string for diagnostics: '${idForDiag}' (type: ${typeof idForDiag}) for loraId: ${loraId}`);
          continue;
        }

        // idForDiag is now a valid, non-empty ObjectId string
        if (!combinedAvailableGridFSIds.has(idForDiag)) {
          issues.missingGridFS++;
        }
      }
    }

    // Orphaned check for loraImages.files (primary bucket)
    // First, get all valid, non-empty image IDs referenced in training data
    const allReferencedTrainingImageIds = new Set();
    for (const train of trainingRaw) {
      const { images } = train;
      if (!Array.isArray(images)) continue;
      for (const imgId of images) {
        let idForRefCheck = imgId;
        if (imgId && (imgId instanceof ObjectId || (imgId._bsontype && imgId._bsontype === 'ObjectId'))) {
          idForRefCheck = imgId.toString();
        }
        if (typeof idForRefCheck === 'string' && idForRefCheck !== '' && ObjectId.isValid(idForRefCheck)) {
          allReferencedTrainingImageIds.add(idForRefCheck);
        }
      }
    }

    issues.orphanedGridFS = 0; // Specific to loraImages.files
    const loraImagesBucketFileIds = new Set(loraImageFileIdDocs.map(doc => doc._id.toString()));
    for (const fileIdStr of loraImagesBucketFileIds) {
      if (!allReferencedTrainingImageIds.has(fileIdStr)) {
        issues.orphanedGridFS++;
      }
    }

    // === GridFS .files vs .chunks diagnostics (specific to loraImages bucket) ===
    console.log('\n🕵️ Auditing GridFS loraImages.files vs loraImages.chunks...');
    // Need full file documents from loraImages.files for this check
    const loraImagesBucketFullFiles = await db.collection('loraImages.files').find({}).toArray();
    const chunkFiles = await db.collection('loraImages.chunks').distinct('files_id');
    
    const filesCollectionIds = new Set(loraImagesBucketFullFiles.map(f => f._id.toString()));
    const chunkFileIds = new Set(chunkFiles.map(id => id.toString()));

    issues.filesMissingChunks = 0;
    for (const fileIdStr of filesCollectionIds) {
      if (!chunkFileIds.has(fileIdStr)) {
        issues.filesMissingChunks++;
      }
    }

    issues.chunksMissingFileEntry = 0;
    for (const chunkFileIdStr of chunkFileIds) {
      if (!filesCollectionIds.has(chunkFileIdStr)) {
        issues.chunksMissingFileEntry++;
      }
    }

    console.log('📊 Diagnostic Summary:\n');
    console.table(issues);

    console.log('\n--- Sample LoRA Document ---');
    console.log(JSON.stringify(loraRaw[0], null, 2));

    console.log('\n--- Sample Training Entry ---');
    console.log(JSON.stringify(trainingRaw[0], null, 2));

    return { loraRaw, trainingRaw };
  } catch (err) {
    console.error('❌ Failed to fetch legacy LoRA data:', err);
    throw err;
  } finally {
    await client.close();
    console.log('🔌 MongoDB connection closed (legacy BOT_NAME)');
  }
}

module.exports = { fetchLegacyLoraData };

if (require.main === module) {
  fetchLegacyLoraData().catch(() => process.exit(1));
}

