/**
 * investigateUserForCookMigration.js
 *
 * Investigates a user by Ethereum wallet address across both databases:
 * - Checks if user exists in Noema (userCore)
 * - Finds their gallery collections in legacy stationthisbot
 * - Finds their studio (generation) records in legacy stationthisbot
 *
 * Usage:
 *   ./run-with-env.sh node scripts/migration/investigateUserForCookMigration.js <wallet_address>
 */

const { MongoClient, ObjectId } = require('mongodb');

const walletAddress = process.argv[2];
if (!walletAddress) {
  console.error('Usage: ./run-with-env.sh node scripts/migration/investigateUserForCookMigration.js <wallet_address>');
  process.exit(1);
}

const normalizedWallet = walletAddress.toLowerCase();
const mongoUri = process.env.MONGO_PASS || process.env.MONGODB_URI;

if (!mongoUri) {
  console.error('Error: MONGO_PASS or MONGODB_URI not set.');
  process.exit(1);
}

(async function main() {
  const client = new MongoClient(mongoUri);

  try {
    console.log(`\n========================================`);
    console.log(`Investigating wallet: ${walletAddress}`);
    console.log(`Normalized: ${normalizedWallet}`);
    console.log(`========================================\n`);

    await client.connect();

    // ========================================
    // 1. Check Noema database (new system)
    // ========================================
    console.log('--- NOEMA DATABASE (New System) ---\n');

    const noemaDb = client.db('noema');
    const userCoreCol = noemaDb.collection('userCore');
    const collectionsCol = noemaDb.collection('collections');
    const cooksCol = noemaDb.collection('cooks');
    const generationOutputsCol = noemaDb.collection('generationOutputs');

    // Find user by wallet (check both cases)
    let noemaUser = await userCoreCol.findOne({ 'wallets.address': normalizedWallet });
    if (!noemaUser) {
      noemaUser = await userCoreCol.findOne({ 'wallets.address': walletAddress });
    }

    if (noemaUser) {
      console.log('✓ User EXISTS in Noema userCore');
      console.log(`  _id (masterAccountId): ${noemaUser._id}`);
      console.log(`  platformIdentities: ${JSON.stringify(noemaUser.platformIdentities)}`);
      console.log(`  wallets: ${noemaUser.wallets?.length || 0}`);
      console.log(`  status: ${noemaUser.status}`);
      console.log(`  created: ${noemaUser.userCreationTimestamp}`);

      // Find their collections in Noema
      const noemaCollections = await collectionsCol.find({
        $or: [
          { userId: noemaUser._id.toString() },
          { userId: noemaUser._id }
        ]
      }).toArray();
      console.log(`\n  Collections in Noema: ${noemaCollections.length}`);
      for (const coll of noemaCollections) {
        console.log(`    - ${coll.name} (collectionId: ${coll.collectionId})`);
      }

      // Find their cooks in Noema
      const noemaCooks = await cooksCol.find({
        $or: [
          { initiatorAccountId: noemaUser._id },
          { initiatorAccountId: noemaUser._id.toString() }
        ]
      }).toArray();
      console.log(`\n  Cooks in Noema: ${noemaCooks.length}`);
      for (const cook of noemaCooks) {
        console.log(`    - collectionId: ${cook.collectionId}, status: ${cook.status}, generated: ${cook.generatedCount}/${cook.targetSupply}`);
      }

      // Find their generation outputs in Noema
      const noemaGenerations = await generationOutputsCol.countDocuments({
        $or: [
          { masterAccountId: noemaUser._id },
          { masterAccountId: noemaUser._id.toString() }
        ]
      });
      console.log(`\n  Generation outputs in Noema: ${noemaGenerations}`);

    } else {
      console.log('✗ User NOT FOUND in Noema userCore');
    }

    // ========================================
    // 2. Check Legacy stationthisbot database
    // ========================================
    console.log('\n--- STATIONTHISBOT DATABASE (Legacy System) ---\n');

    const legacyDb = client.db('stationthisbot');
    const legacyUsersCoreCol = legacyDb.collection('users_core');
    const galleryCol = legacyDb.collection('gallery');
    const studioCol = legacyDb.collection('studio');

    // Find user by wallet in legacy system
    let legacyUser = await legacyUsersCoreCol.findOne({
      'wallets.address': { $regex: new RegExp(`^${walletAddress}$`, 'i') }
    });

    // Also try the old 'wallet' field
    if (!legacyUser) {
      legacyUser = await legacyUsersCoreCol.findOne({
        wallet: { $regex: new RegExp(`^${walletAddress}$`, 'i') }
      });
    }

    if (legacyUser) {
      console.log('✓ User EXISTS in legacy users_core');
      console.log(`  userId: ${legacyUser.userId}`);
      console.log(`  wallet: ${legacyUser.wallet || 'N/A'}`);
      console.log(`  wallets array: ${legacyUser.wallets?.length || 0}`);
      if (legacyUser.wallets) {
        for (const w of legacyUser.wallets) {
          console.log(`    - ${w.address} (${w.type})`);
        }
      }

      // Find their gallery collections
      const galleryCollections = await galleryCol.find({ userId: legacyUser.userId }).toArray();
      console.log(`\n  Gallery collections: ${galleryCollections.length}`);
      for (const coll of galleryCollections) {
        // Count studio pieces for this collection
        const studioCount = await studioCol.countDocuments({ collectionId: coll.collectionId });
        const approvedCount = await studioCol.countDocuments({ collectionId: coll.collectionId, status: 'approved' });
        console.log(`    - collectionId: ${coll.collectionId}`);
        console.log(`      name: ${coll.name || coll.config?.name || 'unnamed'}`);
        console.log(`      studio pieces: ${studioCount} (${approvedCount} approved)`);
        console.log(`      masterPrompt: ${(coll.config?.masterPrompt || '').substring(0, 80)}...`);
      }

      // Check if there are any studio pieces by userId directly
      const studioByUser = await studioCol.countDocuments({ userId: legacyUser.userId });
      console.log(`\n  Total studio pieces by userId: ${studioByUser}`);

    } else {
      console.log('✗ User NOT FOUND in legacy users_core by wallet');

      // Try to find gallery/studio records that might have wallet info
      console.log('\n  Searching gallery for wallet references...');
      const galleryByWallet = await galleryCol.find({
        $or: [
          { wallet: { $regex: new RegExp(walletAddress, 'i') } },
          { 'config.wallet': { $regex: new RegExp(walletAddress, 'i') } },
          { ownerWallet: { $regex: new RegExp(walletAddress, 'i') } }
        ]
      }).toArray();

      if (galleryByWallet.length > 0) {
        console.log(`  Found ${galleryByWallet.length} gallery records with wallet reference`);
        for (const g of galleryByWallet) {
          console.log(`    - collectionId: ${g.collectionId}, userId: ${g.userId}`);
        }
      } else {
        console.log('  No gallery records found with this wallet');
      }
    }

    // ========================================
    // 3. Summary and Migration Recommendations
    // ========================================
    console.log('\n========================================');
    console.log('MIGRATION SUMMARY');
    console.log('========================================\n');

    if (!noemaUser && legacyUser) {
      console.log('RECOMMENDATION: User needs to be migrated to Noema first');
      console.log(`  Legacy userId: ${legacyUser.userId}`);
      console.log('  Then migrate their gallery/studio data');
    } else if (noemaUser && legacyUser) {
      console.log('RECOMMENDATION: User exists in both systems');
      console.log(`  Noema masterAccountId: ${noemaUser._id}`);
      console.log(`  Legacy userId: ${legacyUser.userId}`);
      console.log('  Ready to migrate gallery/studio → collections/cooks');
    } else if (noemaUser && !legacyUser) {
      console.log('NOTE: User exists in Noema but not in legacy system');
      console.log('  No legacy data to migrate');
    } else {
      console.log('NOTE: User not found in either system');
    }

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.close();
  }
})();
