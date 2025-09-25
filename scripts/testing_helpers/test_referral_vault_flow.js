// Node script: quick sanity-check for referral-vault flow without running full app.
// Usage:   node scripts/testing_helpers/test_referral_vault_flow.js <ownerAddress>
// Requires env: FOUNDATION_ADDRESS, CHARTER_BEACON_ADDRESS, RPC_URL
// For write-tx simulation the script only uses staticCall – no state change.

const { ethers } = require('ethers');
const path = require('path');
const { predictDeterministicAddressERC1967BeaconProxy, encodeCharteredFundInitArgs, hasVanityPrefix } = require('../../src/core/services/alchemy/beaconProxyHelper');

async function main() {
    const owner = process.argv[2];
    if (!owner || !ethers.isAddress(owner)) {
        console.error('Usage: node test_referral_vault_flow.js <ownerAddress>');
        process.exit(1);
    }

    const foundationAddress = process.env.FOUNDATION_ADDRESS;
    const beaconAddress = '0xeEd94eD20B79ED938518c6eEa4129cB1E8b8665C'; // Use correct beacon address
    const rpcUrl = process.env.ETHEREUM_RPC_URL || process.env.ALCHEMY_RPC_URL;

    if (!foundationAddress || !beaconAddress || !rpcUrl) {
        console.error('Missing FOUNDATION_ADDRESS, CHARTER_BEACON_ADDRESS, or RPC_URL env vars');
        process.exit(1);
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const foundationAbi = require('../../src/core/contracts/abis/foundation.json');
    const foundation = new ethers.Contract(foundationAddress, foundationAbi, provider);

    // --- Quick sanity-check: does our local predictor match the on-chain logic? ---
    const initArgs = encodeCharteredFundInitArgs(foundationAddress, owner);
    const dummySalt = ethers.hexlify(ethers.randomBytes(32));
    const localDummyPred = predictDeterministicAddressERC1967BeaconProxy(beaconAddress, initArgs, dummySalt, foundationAddress);
    const chainDummyPred = await foundation.computeCharterAddress.staticCall(owner, dummySalt);
    if (localDummyPred.toLowerCase() !== chainDummyPred.toLowerCase()) {
        console.error('ERROR: Local prediction logic DOES NOT match on-chain computeCharterAddress. Verify beaconAddress and init-code logic.');
        console.table({ localDummyPred, chainDummyPred, beaconAddress });
        process.exit(2);
    }

    // Mining parameters
    const maxAttempts = parseInt(process.argv[3] || '250000', 10); // default 250k ( > 2^16 )

    console.log(`--- Salt mining (up to ${maxAttempts.toLocaleString()} attempts) ---`);

    for (let i = 0; i < maxAttempts; i++) {
        const salt = ethers.hexlify(ethers.randomBytes(32));
        const predicted = predictDeterministicAddressERC1967BeaconProxy(beaconAddress, initArgs, salt, foundationAddress);
        if (!hasVanityPrefix(predicted)) continue;

        const onChainPred = await foundation.computeCharterAddress.staticCall(owner, salt);
        if (onChainPred.toLowerCase() !== predicted.toLowerCase()) continue; // mismatch

        try {
            await foundation.charterFund.staticCall(owner, salt);
            console.log('SUCCESS: found deployable salt');
            console.table({ salt, predicted });
            return;
        } catch (err) {
            // Decode custom error if available
            const iface = new ethers.Interface(foundationAbi);
            try { console.log('Rejected:', iface.parseError(err.data || err)); } catch {}
        }
    }
    console.error('Failed to find valid salt within attempt limit');
    process.exit(2);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
