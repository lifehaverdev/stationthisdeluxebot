import { ethers } from 'ethers';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const foundationAbi = require('./src/core/contracts/abis/foundation.json');
const FOUNDATION = '0x01152530028bd834EDbA9744885A882D025D84F6';
const TOKEN = '0x0000000000000000000000000000000000000000';

const provider = new ethers.JsonRpcProvider('https://eth-mainnet.g.alchemy.com/v2/79w6H2dT_VVw3Z_W3RWoZsoEf885R1wF');
const iface = new ethers.Interface(foundationAbi);

function splitCustody(packed) {
  const v = BigInt(packed);
  return { userOwned: v & ((1n << 128n) - 1n), escrow: v >> 128n };
}
function getCustodyKey(user, token) {
  return ethers.solidityPackedKeccak256(['address', 'address'], [user, token]);
}

const latestBlock = await provider.getBlockNumber();
const fromBlock = latestBlock - 50000;

const logs = await provider.getLogs({ address: FOUNDATION, fromBlock, toBlock: latestBlock });
console.log(`Total logs: ${logs.length}`);

// Collect unique addresses from all logs
const allAddrs = new Set();
allAddrs.add(FOUNDATION.toLowerCase());

for (const log of logs) {
  // Try parsing
  try {
    const parsed = iface.parseLog(log);
    if (parsed) {
      console.log(`\nEvent: ${parsed.name}`);
      for (const [k, v] of Object.entries(parsed.args.toObject())) {
        if (typeof v === 'string' && v.startsWith('0x') && v.length === 42) {
          allAddrs.add(v.toLowerCase());
        }
        console.log(`  ${k}: ${v}`);
      }
    }
  } catch {
    // Unknown event - show raw topic
    if (log.topics[0]) {
      console.log(`\nUnknown event topic: ${log.topics[0]}`);
      // Extract addresses from topics (skip topic[0] which is event sig)
      for (let i = 1; i < log.topics.length; i++) {
        if (log.topics[i].length === 66) {
          const possibleAddr = '0x' + log.topics[i].slice(26);
          if (ethers.isAddress(possibleAddr)) allAddrs.add(possibleAddr.toLowerCase());
        }
      }
    }
  }
}

// Now check custody for every address we found
console.log(`\n\nChecking custody for ${allAddrs.size} addresses...`);
const foundation = new ethers.Contract(FOUNDATION, foundationAbi, provider);
let total = 0n;
for (const addr of allAddrs) {
  const raw = await foundation.custody(getCustodyKey(addr, TOKEN));
  const { userOwned, escrow } = splitCustody(raw);
  if (userOwned > 0n || escrow > 0n) {
    console.log(`${addr.slice(0,16)}: userOwned=${ethers.formatEther(userOwned)} escrow=${ethers.formatEther(escrow)}`);
    total += userOwned + escrow;
  }
}
console.log(`\nTotal accounted: ${ethers.formatEther(total)} ETH`);
console.log(`Contract balance: ${ethers.formatEther(await provider.getBalance(FOUNDATION))} ETH`);
