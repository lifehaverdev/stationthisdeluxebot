const fs = require('fs');
const { Wallet } = require('ethers');
const path = require('path');
const readline = require('readline');
const os = require('os');

/**
 * A helper function to ask a question on the command line.
 * It ensures prompts are visible even when stdout is being captured.
 * @param {string} query The question to ask.
 * @param {boolean} isPassword If true, masks the input.
 * @returns {Promise<string>} The user's answer.
 */
function ask(query, isPassword = false) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr, // Always write prompts to stderr to avoid capture
    terminal: true
  });

  return new Promise(resolve => {
    rl.question(query, answer => {
      rl.close();
      // Add a newline to stderr after the prompt is answered,
      // especially important for the password prompt.
      if (isPassword) {
        process.stderr.write('\n');
      }
      resolve(answer);
    });

    // Mask password input if needed
    if (isPassword) {
      rl.stdoutMuted = true;
      rl._writeToOutput = function _writeToOutput() {
        rl.output.write(`\r\x1B[2K\x1B[200D` + query);
      };
    }
  });
}

/**
 * @fileoverview A helper script to securely decrypt an Ethereum JSON keystore
 * and export the private key for a single terminal session.
 * 
 * Usage:
 * 1. From your terminal, run:
 *    export PRIVATE_KEY=$(node scripts/local_dev_helpers/loadKeystore.js < /dev/tty)
 * 2. The script will prompt for the path to your keystore file and the password.
 * 3. If successful, the private key will be loaded into the PRIVATE_KEY
 *    environment variable for your current session without being logged or displayed.
 */
async function main() {
  const defaultPath = '/etc/account/STATIONTHIS';
  const cliArgPath = process.argv.includes('--path') ? process.argv[process.argv.indexOf('--path') + 1] : null;

  if (!process.stdin.isTTY) {
    console.error(`
This script is interactive and requires a TTY (terminal) for input.
It seems you are running it in a subshell or piping input to it.

To make it work, please run it like this:
  export PRIVATE_KEY=$(node ${process.argv[1]} --path /etc/account/STATIONTHIS < /dev/tty)
`);
    process.exit(1);
  }

  try {
    let keystorePath = cliArgPath;

    if (!keystorePath) {
      const keystorePathInput = await ask('Enter the path to your encrypted JSON keystore file (default: /etc/account/STATIONTHIS): ');
      keystorePath = keystorePathInput.trim() || defaultPath;
    }

    // Expand ~
    if (keystorePath.startsWith('~')) {
      keystorePath = path.join(os.homedir(), keystorePath.slice(1));
    }

    const resolvedPath = resolveKeystoreFilePath(keystorePath);

    const password = await ask('Enter your keystore password: ', true);

    if (!password) {
      console.error('\nOperation cancelled by user.');
      process.exit(1);
    }

    const encryptedJson = fs.readFileSync(resolvedPath, 'utf8');
    const wallet = Wallet.fromEncryptedJsonSync(encryptedJson, password);

    process.stdout.write(wallet.privateKey);

  } catch (error) {
    if (error.message.includes('invalid password')) {
      console.error('\nDecryption failed: Invalid password.');
    } else if (error.code === 'ENOENT') {
      console.error(`\nError: Keystore file not found at '${error.path}'.`);
    } else {
      console.error('\nAn unexpected error occurred:', error.message);
    }
    process.exit(1);
  }
}

function resolveKeystoreFilePath(inputPath) {
  let resolvedPath = path.resolve(inputPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`\nError: File not found at the resolved path: ${resolvedPath}`);
    process.exit(1);
  }

  const stat = fs.statSync(resolvedPath);
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(resolvedPath)
      .filter(name => !name.startsWith('.'))
      .filter(name => name.toLowerCase().endsWith('.json') || name.startsWith('UTC'));

    if (!entries.length) {
      console.error(`\nError: Directory provided but no keystore JSON files found in: ${resolvedPath}`);
      process.exit(1);
    }

    const enriched = entries.map(name => {
      const fullPath = path.join(resolvedPath, name);
      const stats = fs.statSync(fullPath);
      return { name, fullPath, mtime: stats.mtimeMs };
    });
    enriched.sort((a, b) => b.mtime - a.mtime);
    const selected = enriched[0];
    console.error(`[loadKeystore] Provided path is a directory; using newest file: ${selected.name}`);
    resolvedPath = selected.fullPath;
  }

  return resolvedPath;
}

main(); 
