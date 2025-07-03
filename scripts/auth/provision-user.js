// This script provisions a user with a hashed password for testing purposes.
// Usage: node scripts/auth/provision-user.js <username> <password>

const crypto = require('crypto');
const { initializeDatabase } = require('../../src/core/initDB');
const { UserCoreDB } = require('../../src/core/services/db/userCoreDb'); 
const { createLogger } = require('../../src/utils/logger');

const logger = createLogger('ProvisionUser');

async function provisionUser() {
  const [,, username, password] = process.argv;

  if (!username || !password) {
    logger.error('Usage: node scripts/auth/provision-user.js <username> <password>');
    process.exit(1);
  }

  try {
    await initializeDatabase();
    const userCoreDb = new UserCoreDB(logger);

    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, async (err, derivedKey) => {
      if (err) throw err;
      
      const passwordHash = derivedKey.toString('hex');
      
      const userDoc = {
        'profile.username': username,
        'profile.passwordHash': passwordHash,
        'profile.passwordSalt': salt,
        'status': 'active',
      };

      await userCoreDb.collection.updateOne(
        { 'profile.username': username },
        { $set: userDoc, $setOnInsert: { userCreationTimestamp: new Date(), wallets: [], apiKeys: [], awards: [] } },
        { upsert: true }
      );

      logger.info(`User '${username}' provisioned successfully.`);
      process.exit(0);
    });
  } catch (error) {
    logger.error('Failed to provision user:', error);
    process.exit(1);
  }
}

provisionUser(); 