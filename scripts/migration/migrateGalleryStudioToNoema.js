/**
 * migrateGalleryStudioToNoema.js
 *
 * Migrates a user's gallery collections and studio records from legacy stationthisbot
 * database to the noema database (collections, cooks, generationOutputs).
 *
 * Usage:
 *   scripts/run-with-env.sh node scripts/migration/migrateGalleryStudioToNoema.js <wallet_address> [--dry-run] [--collection <collectionId>]
 *
 * Options:
 *   --dry-run              Preview changes without writing to database
 *   --collection <id>      Only migrate a specific collection (by legacy collectionId)
 */

const { MongoClient, ObjectId } = require('mongodb');
const { v4: uuidv4 } = require('uuid');

// Parse CLI args
const args = process.argv.slice(2);
const walletAddress = args.find(a => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const collectionIdxArg = args.indexOf('--collection');
const specificCollectionId = collectionIdxArg !== -1 ? args[collectionIdxArg + 1] : null;

if (!walletAddress) {
  console.error('Usage: scripts/run-with-env.sh node scripts/migration/migrateGalleryStudioToNoema.js <wallet_address> [--dry-run] [--collection <collectionId>]');
  process.exit(1);
}

const normalizedWallet = walletAddress.toLowerCase();
const mongoUri = process.env.MONGO_PASS || process.env.MONGODB_URI;

if (!mongoUri) {
  console.error('Error: MONGO_PASS or MONGODB_URI not set.');
  process.exit(1);
}

/**
 * Maps legacy studio status to noema generationOutput status
 */
function mapStudioStatus(legacyStatus) {
  const statusMap = {
    'approved': 'success',
    'rejected': 'success', // Still generated successfully, just not approved for collection
    'pending': 'pending',
    'processing': 'processing',
    'failed': 'failed',
    'culled': 'success', // Culled means it was generated but removed
  };
  return statusMap[legacyStatus] || 'success';
}

/**
 * Maps legacy studio status to review outcome
 */
function mapReviewOutcome(legacyStatus) {
  const outcomeMap = {
    'approved': 'approved',
    'rejected': 'rejected',
    'culled': 'culled',
  };
  return outcomeMap[legacyStatus] || null;
}

(async function main() {
  const client = new MongoClient(mongoUri);

  try {
    console.log(`\n========================================`);
    console.log(`Gallery/Studio Migration to Noema`);
    console.log(`Wallet: ${walletAddress}`);
    console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
    if (specificCollectionId) console.log(`Specific collection: ${specificCollectionId}`);
    console.log(`========================================\n`);

    await client.connect();

    // Connect to both databases
    const legacyDb = client.db('stationthisbot');
    const noemaDb = client.db('noema');

    // Collections
    const legacyUsersCore = legacyDb.collection('users_core');
    const galleryCol = legacyDb.collection('gallery');
    const studioCol = legacyDb.collection('studio');

    const userCoreCol = noemaDb.collection('userCore');
    const collectionsCol = noemaDb.collection('collections');
    const cooksCol = noemaDb.collection('cooks');
    const generationOutputsCol = noemaDb.collection('generationOutputs');

    // ========================================
    // Step 1: Find user in both databases
    // ========================================
    console.log('Step 1: Finding user in both databases...\n');

    // Find in Noema
    let noemaUser = await userCoreCol.findOne({ 'wallets.address': normalizedWallet });
    if (!noemaUser) {
      noemaUser = await userCoreCol.findOne({ 'wallets.address': walletAddress });
    }

    // Find in legacy
    let legacyUser = await legacyUsersCore.findOne({
      'wallets.address': { $regex: new RegExp(`^${walletAddress}$`, 'i') }
    });
    if (!legacyUser) {
      legacyUser = await legacyUsersCore.findOne({
        wallet: { $regex: new RegExp(`^${walletAddress}$`, 'i') }
      });
    }

    if (!legacyUser) {
      console.error('ERROR: User not found in legacy stationthisbot database');
      process.exit(1);
    }

    const legacyUserId = legacyUser.userId;
    console.log(`  Legacy userId: ${legacyUserId}`);

    // Create noema user if needed
    let masterAccountId;
    if (noemaUser) {
      masterAccountId = noemaUser._id;
      console.log(`  Noema masterAccountId: ${masterAccountId} (existing)`);
    } else {
      console.log('  User not in Noema - will create during migration');
      if (!dryRun) {
        const newUser = {
          platformIdentities: { telegram: legacyUserId.toString() },
          wallets: [{
            address: normalizedWallet,
            type: 'CONNECTED_ETH',
            isPrimary: true,
            verified: true,
            addedAt: new Date(),
          }],
          status: 'active',
          userCreationTimestamp: new Date(),
          updatedAt: new Date(),
        };
        const result = await userCoreCol.insertOne(newUser);
        masterAccountId = result.insertedId;
        console.log(`  Created Noema user with masterAccountId: ${masterAccountId}`);
      } else {
        masterAccountId = new ObjectId(); // Placeholder for dry run
        console.log(`  [DRY RUN] Would create user with masterAccountId: ${masterAccountId}`);
      }
    }

    // ========================================
    // Step 2: Find legacy gallery collections
    // ========================================
    console.log('\nStep 2: Finding legacy gallery collections...\n');

    let galleryQuery = { userId: legacyUserId };
    if (specificCollectionId) {
      // Handle both numeric and string collectionIds
      const numericId = parseInt(specificCollectionId);
      galleryQuery.collectionId = isNaN(numericId) ? specificCollectionId : numericId;
    }

    const legacyCollections = await galleryCol.find(galleryQuery).toArray();
    console.log(`  Found ${legacyCollections.length} gallery collection(s)`);

    // ========================================
    // Step 3: Migrate each collection
    // ========================================
    console.log('\nStep 3: Migrating collections...\n');

    const migrationResults = {
      collectionsCreated: 0,
      collectionsSkipped: 0,
      cooksCreated: 0,
      generationsCreated: 0,
      generationsSkipped: 0,
    };

    for (const legacyGallery of legacyCollections) {
      const legacyCollectionId = legacyGallery.collectionId;
      console.log(`\n--- Processing collection: ${legacyGallery.name} (${legacyCollectionId}) ---`);

      // Check if collection already exists in noema (by name and userId, or by legacy ID in metadata)
      const existingCollection = await collectionsCol.findOne({
        $or: [
          { userId: masterAccountId.toString(), name: legacyGallery.name },
          { 'config.legacyCollectionId': legacyCollectionId },
          { 'metadata.legacyCollectionId': legacyCollectionId },
        ]
      });

      let noemaCollectionId;
      if (existingCollection) {
        console.log(`  Collection already exists in Noema: ${existingCollection.collectionId}`);
        noemaCollectionId = existingCollection.collectionId;
        migrationResults.collectionsSkipped++;
      } else {
        // Create new collection
        noemaCollectionId = uuidv4();

        // Transform legacy traitTypes to new traitTree format
        const transformedTraitTree = (legacyGallery.config?.traitTypes || []).map(category => ({
          name: category.title, // Convert 'title' to 'name'
          mode: 'manual',
          traits: (category.traits || []).map(trait => ({
            name: trait.name,
            value: trait.prompt, // Convert 'prompt' to 'value'
            prompt: trait.prompt, // Keep prompt for reference
            rarity: trait.rarity,
          })),
        }));

        const noemaCollection = {
          collectionId: noemaCollectionId,
          name: legacyGallery.name,
          description: legacyGallery.description || legacyGallery.editionTitle || '',
          userId: masterAccountId.toString(),
          config: {
            masterPrompt: legacyGallery.config?.masterPrompt || '',
            traitTree: transformedTraitTree,
            workflow: legacyGallery.config?.workflow || 'MAKE',
            // Store legacy reference
            legacyCollectionId: legacyCollectionId,
            legacyChain: legacyGallery.chain,
            legacyTotalSupply: legacyGallery.totalSupply,
            legacyRoyalties: legacyGallery.royalties,
          },
          metadata: {
            legacyCollectionId: legacyCollectionId,
            migratedAt: new Date(),
            migrationSource: 'stationthisbot_gallery',
          },
          createdAt: legacyGallery.initiated ? new Date(legacyGallery.initiated) : new Date(),
          updatedAt: new Date(),
        };

        if (!dryRun) {
          await collectionsCol.insertOne(noemaCollection);
          console.log(`  Created collection: ${noemaCollectionId}`);
        } else {
          console.log(`  [DRY RUN] Would create collection: ${noemaCollectionId}`);
        }
        migrationResults.collectionsCreated++;
      }

      // ========================================
      // Step 4: Find and migrate studio pieces
      // ========================================
      const studioPieces = await studioCol.find({ collectionId: legacyCollectionId }).toArray();
      console.log(`  Found ${studioPieces.length} studio pieces`);

      if (studioPieces.length === 0) {
        console.log('  No studio pieces to migrate');
        continue;
      }

      // Create a cook record for this migration batch
      let cookId;
      if (!dryRun) {
        const cookDoc = {
          collectionId: noemaCollectionId,
          initiatorAccountId: masterAccountId,
          targetSupply: studioPieces.length,
          generatedCount: 0,
          status: 'completed',
          metadata: {
            migrationSource: 'stationthisbot_studio',
            legacyCollectionId: legacyCollectionId,
            migratedAt: new Date(),
          },
          startedAt: studioPieces[0]?.createdAt ? new Date(studioPieces[0].createdAt) : new Date(),
          updatedAt: new Date(),
          generationIds: [],
          events: [],
        };
        const cookResult = await cooksCol.insertOne(cookDoc);
        cookId = cookResult.insertedId;
        console.log(`  Created cook: ${cookId}`);
        migrationResults.cooksCreated++;
      } else {
        cookId = new ObjectId();
        console.log(`  [DRY RUN] Would create cook: ${cookId}`);
        migrationResults.cooksCreated++;
      }

      // Migrate each studio piece to generationOutputs
      const generationIds = [];
      for (const piece of studioPieces) {
        // Check if this piece already exists (by legacy _id in metadata)
        const existingGen = await generationOutputsCol.findOne({
          'metadata.legacyStudioId': piece._id.toString()
        });

        if (existingGen) {
          migrationResults.generationsSkipped++;
          generationIds.push(existingGen._id);
          continue;
        }

        // Transform to generationOutput
        const genDoc = {
          masterAccountId: masterAccountId,
          serviceName: 'legacy_migration',
          toolId: piece.workflow || 'MAKE',
          toolDisplayName: piece.workflow || 'MAKE',
          status: mapStudioStatus(piece.status),
          deliveryStatus: 'migrated',
          artifactUrls: (piece.files || []).map(f => ({
            url: f.url,
            type: f.type || 'image',
          })),
          requestPayload: {
            prompt: piece.prompt,
            traits: piece.traits,
          },
          responsePayload: {
            generation: piece.generation,
          },
          metadata: {
            collectionId: noemaCollectionId,
            legacyStudioId: piece._id.toString(),
            legacyCollectionId: legacyCollectionId,
            reviewOutcome: mapReviewOutcome(piece.status),
            assignedNumber: piece.assignedNumber,
            isIn: piece.isIn,
            configHash: piece.configHash,
            traits: piece.traits,
            migratedAt: new Date(),
            migrationSource: 'stationthisbot_studio',
          },
          requestTimestamp: piece.createdAt ? new Date(piece.createdAt) : new Date(),
          responseTimestamp: piece.statusUpdatedAt ? new Date(piece.statusUpdatedAt) : new Date(),
        };

        if (piece.generation) {
          genDoc.metadata.seed = piece.generation.seed;
          genDoc.metadata.cfg = piece.generation.cfg;
          genDoc.metadata.checkpoint = piece.generation.checkpoint;
          genDoc.durationMs = piece.generation.duration;
        }

        if (!dryRun) {
          const genResult = await generationOutputsCol.insertOne(genDoc);
          generationIds.push(genResult.insertedId);
        } else {
          generationIds.push(new ObjectId());
        }
        migrationResults.generationsCreated++;
      }

      // Update cook with generation IDs
      if (!dryRun && cookId) {
        await cooksCol.updateOne(
          { _id: cookId },
          {
            $set: {
              generationIds: generationIds,
              generatedCount: generationIds.length,
              updatedAt: new Date(),
            }
          }
        );
        console.log(`  Updated cook with ${generationIds.length} generation IDs`);
      } else {
        console.log(`  [DRY RUN] Would update cook with ${generationIds.length} generation IDs`);
      }

      console.log(`  Migrated: ${migrationResults.generationsCreated} generations, skipped: ${migrationResults.generationsSkipped}`);
    }

    // ========================================
    // Summary
    // ========================================
    console.log('\n========================================');
    console.log('MIGRATION SUMMARY');
    console.log('========================================');
    console.log(`Mode: ${dryRun ? 'DRY RUN (no changes made)' : 'LIVE'}`);
    console.log(`Collections created: ${migrationResults.collectionsCreated}`);
    console.log(`Collections skipped (existing): ${migrationResults.collectionsSkipped}`);
    console.log(`Cooks created: ${migrationResults.cooksCreated}`);
    console.log(`Generations created: ${migrationResults.generationsCreated}`);
    console.log(`Generations skipped (existing): ${migrationResults.generationsSkipped}`);
    console.log('========================================\n');

    if (dryRun) {
      console.log('To perform the actual migration, run without --dry-run flag');
    }

  } catch (err) {
    console.error('Migration error:', err);
    process.exit(1);
  } finally {
    await client.close();
  }
})();
