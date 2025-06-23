const { keccak256, toUtf8Bytes } = require('ethers');

const errorSignatures = [
    "NotOwner()",
    "NotBackend()",
    "NotVaultAccount()",
    "NotEnoughInProtocolEscrow()",
    "InsufficientUserOwnedBalance()",
    "InsufficientEscrowBalance()",
    "BadFeeMath()",
    "OperatorFrozen()",
    "Create2Failed()",
    "MulticallFailed()",
    "MulticallOnlyByOrigin()",
    "InvalidVaultAccountPrefix()"
];

const targetErrorHash = "0x393a172f";

console.log("Verifying custom error hash from logs...");
console.log(`Target hash: ${targetErrorHash}`);
console.log("----------------------------------------");

let matchFound = false;

errorSignatures.forEach(signature => {
    const hash = keccak256(toUtf8Bytes(signature));
    const selector = hash.substring(0, 10); // First 4 bytes (8 hex chars + '0x')

    process.stdout.write(`- Hashing "${signature}"... `);

    if (selector === targetErrorHash) {
        console.log(`✅ MATCH! (${selector})`);
        matchFound = true;
    } else {
        console.log(`(is ${selector})`);
    }
});

console.log("----------------------------------------");

if (matchFound) {
    console.log("Verification successful. The error is confirmed.");
} else {
    console.log("Verification failed. The error hash does not match any known errors.");
} 