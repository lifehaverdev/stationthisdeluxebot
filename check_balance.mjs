import { ethers } from 'ethers';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const foundationAbi = require('./src/core/contracts/abis/foundation.json');
const charterFundAbi = require('./src/core/contracts/abis/charteredFund.json');

const FOUNDATION = '0x01152530028bd834EDbA9744885A882D025D84F6';
const CHARTER    = '0x1152Ace2d1341095055220C3FeeFb5F690981b13';
const TOKEN = '0x0000000000000000000000000000000000000000';

const provider = new ethers.JsonRpcProvider('https://eth-mainnet.g.alchemy.com/v2/79w6H2dT_VVw3Z_W3RWoZsoEf885R1wF');

function splitCustody(packed) {
  const v = BigInt(packed);
  return { userOwned: v & ((1n << 128n) - 1n), escrow: v >> 128n };
}
function getCustodyKey(user, token) {
  return ethers.solidityPackedKeccak256(['address', 'address'], [user, token]);
}

// Actual ETH balances
const foundationBal = await provider.getBalance(FOUNDATION);
const charterBal    = await provider.getBalance(CHARTER);
console.log(`Foundation ETH balance: ${ethers.formatEther(foundationBal)} ETH`);
console.log(`CharterFund ETH balance: ${ethers.formatEther(charterBal)} ETH`);

// Protocol-level custody (Foundation address as user)
const foundation = new ethers.Contract(FOUNDATION, foundationAbi, provider);
const charter    = new ethers.Contract(CHARTER, charterFundAbi, provider);

const fProtocolRaw = await foundation.custody(getCustodyKey(FOUNDATION, TOKEN));
const { userOwned: fProtocolOwned, escrow: fProtocolEscrow } = splitCustody(fProtocolRaw);
console.log(`\nFoundation.custody[Foundation][ETH]: userOwned=${ethers.formatEther(fProtocolOwned)} escrow=${ethers.formatEther(fProtocolEscrow)}`);

const cProtocolRaw = await charter.custody(getCustodyKey(CHARTER, TOKEN));
const { userOwned: cProtocolOwned, escrow: cProtocolEscrow } = splitCustody(cProtocolRaw);
console.log(`CharterFund.custody[CharterFund][ETH]: userOwned=${ethers.formatEther(cProtocolOwned)} escrow=${ethers.formatEther(cProtocolEscrow)}`);

// Try totalSupply or any balance-tracking view
try {
  const ts = await foundation.totalSupply();
  console.log(`\nFoundation.totalSupply(): ${ts}`);
} catch(e) { /* no totalSupply */ }

// Scan all custody keys we can find via recent Transfer/ContributionRecorded logs
console.log('\nFetching ContributionRecorded logs from Foundation (last 50k blocks)...');
const latestBlock = await provider.getBlockNumber();
const fromBlock = latestBlock - 50000;
const topic = ethers.id('ContributionRecorded(address,address,address,uint256)');
const logs = await provider.getLogs({
  address: FOUNDATION,
  fromBlock,
  toBlock: latestBlock,
});
console.log(`Total logs from Foundation (any topic, last 50k blocks): ${logs.length}`);

// Collect unique depositors from logs
const iface = new ethers.Interface(foundationAbi);
const depositors = new Set();
for (const log of logs) {
  try {
    const parsed = iface.parseLog(log);
    if (parsed?.name === 'ContributionRecorded') {
      depositors.add(parsed.args.user?.toLowerCase());
    }
  } catch {}
}
console.log(`Unique depositors from on-chain logs: ${depositors.size}`);

let grandTotal = 0n;
for (const dep of depositors) {
  const raw = await foundation.custody(getCustodyKey(dep, TOKEN));
  const { userOwned, escrow } = splitCustody(raw);
  if (userOwned > 0n || escrow > 0n) {
    console.log(`  ${dep.slice(0,14)}: userOwned=${ethers.formatEther(userOwned)} escrow=${ethers.formatEther(escrow)}`);
    grandTotal += userOwned + escrow;
  }
}
console.log(`\nSum of all userOwned+escrow from on-chain logs: ${ethers.formatEther(grandTotal)} ETH`);
console.log(`Unaccounted (contract bal - sum): ${ethers.formatEther(foundationBal - grandTotal)} ETH`);
