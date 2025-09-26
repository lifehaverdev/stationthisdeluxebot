const { ethers } = require('ethers');

function showSignerAddress() {
    const privateKey = process.env.ETHEREUM_SIGNER_PRIVATE_KEY;
    
    if (!privateKey) {
        console.log('❌ ETHEREUM_SIGNER_PRIVATE_KEY not set');
        console.log('Please run with: ./run-with-env.sh node scripts/debug/show_signer_address.js');
        process.exit(1);
    }
    
    try {
        const wallet = new ethers.Wallet(privateKey);
        console.log('🔑 Signer address from loaded private key:', wallet.address);
        console.log('✅ This is the address that will be used for blockchain transactions');
    } catch (error) {
        console.error('❌ Error creating wallet from private key:', error.message);
        process.exit(1);
    }
}

showSignerAddress();
