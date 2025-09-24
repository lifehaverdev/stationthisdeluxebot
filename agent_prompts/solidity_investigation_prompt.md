# Solidity Repository Investigation Prompt

## 🎯 Mission
Investigate the Solidity repository (credit-vault) to find definitive answers about the ERC1967 beacon proxy implementation that will help resolve the byte-layout discrepancy between our JavaScript implementation and the on-chain `Foundation.computeCharterAddress`.

## 🔍 Context
We have a JavaScript implementation of `initCodeHashERC1967BeaconProxy` that should match Solady v0.8.28 `LibClone` behavior, but our calculated hash `0xa1aa07c9cc88d386a06e47b4afce696ba67087b8e79cb42f0d4bab09d253ab6e` doesn't match the expected `0x673b91cb887b557e9f95d3d449d50f9e130594cedf823272542df21fa656f247` from the contract debug helper.

## 📋 Investigation Tasks

### 1. Locate and Analyze LibClone Implementation
- **Find**: The exact Solady v0.8.28 `LibClone` implementation in the repository
- **Analyze**: The `cloneDeterministicERC1967` function and its bytecode generation
- **Extract**: The exact Yul assembly code that generates the init code
- **Document**: Memory layout, offsets, and byte arrangements

### 2. Examine Foundation Contract
- **Find**: The `Foundation.sol` contract and its `computeCharterAddress` function
- **Analyze**: How it calls LibClone and what parameters it passes
- **Identify**: The exact beacon address, args encoding, and salt handling
- **Document**: The complete call flow from Foundation to LibClone

### 3. Create Debug Scripts
Create Foundry scripts that will help us understand the byte layout:

#### Script A: Init Code Inspector
```solidity
// scripts/debug/InspectInitCode.sol
contract InitCodeInspector {
    function inspectBeaconProxyInitCode(
        address beacon,
        bytes memory args
    ) public pure returns (
        bytes memory initCode,
        bytes32 initCodeHash,
        bytes memory prefixBytes,
        bytes memory beaconBytes,
        bytes memory runtimeCode1,
        bytes memory runtimeCode2,
        bytes memory runtimeCode3,
        bytes memory argsBytes
    ) {
        // Use LibClone to generate init code
        // Break down each component
        // Return all parts for analysis
    }
}
```

#### Script B: Byte-by-Byte Comparison
```solidity
// scripts/debug/ByteComparison.sol
contract ByteComparison {
    function compareInitCodes(
        address beacon,
        bytes memory args
    ) public pure returns (
        bytes memory expectedInitCode,
        bytes memory actualInitCode,
        bool[] memory byteMatches,
        uint256 firstMismatchIndex
    ) {
        // Generate expected init code using LibClone
        // Compare byte-by-byte with our JavaScript output
        // Return detailed comparison results
    }
}
```

#### Script C: Memory Layout Analyzer
```solidity
// scripts/debug/MemoryLayoutAnalyzer.sol
contract MemoryLayoutAnalyzer {
    function analyzeMemoryLayout(
        address beacon,
        bytes memory args
    ) public pure returns (
        bytes32 prefixWord,
        bytes32 beaconWord,
        bytes32 runtimeWord1,
        bytes32 runtimeWord2,
        bytes32 runtimeWord3,
        bytes memory argsLayout
    ) {
        // Show exactly how LibClone lays out memory
        // Break down each mstore operation
        // Show the exact byte positions
    }
}
```

### 4. Test with Known Values
Create a test that uses the exact same values we're using:

```solidity
// test/BeaconProxyDebug.t.sol
contract BeaconProxyDebugTest is Test {
    address constant FOUNDATION_ADDRESS = 0x01152530028BD834EDBA9744885A882D025D84F6;
    address constant CHARTER_BEACON_ADDRESS = 0xeEd94eD20B79ED938518c6eEa4129cB1E8b8665C;
    address constant OWNER_ADDRESS = 0x1821BD18CBdD267CE4e389f893dDFe7BEB333aB6;
    
    function testBeaconProxyInitCode() public {
        // Encode args exactly like our JavaScript
        bytes memory args = abi.encodeWithSelector(
            bytes4(0x485cc955), // initialize selector
            FOUNDATION_ADDRESS,
            OWNER_ADDRESS
        );
        
        // Generate init code using LibClone
        // Print detailed byte-by-byte output
        // Compare with our expected hash
    }
}
```

### 5. Verbose Output Requirements
Make all scripts extremely verbose:

- **Print every byte** of the generated init code in hex
- **Show memory offsets** for each component
- **Display the exact Yul assembly** being executed
- **Log intermediate values** during init code construction
- **Compare with expected values** step by step

### 6. Specific Questions to Answer

1. **What is the exact beacon address** passed to LibClone in `Foundation.computeCharterAddress`?
2. **How are the initialization args encoded** before being passed to LibClone?
3. **What is the exact memory layout** produced by the Yul assembly?
4. **Are there any differences** between the LibClone version in the repo and Solady v0.8.28?
5. **What is the exact prefix calculation** in the Yul assembly?
6. **How does the beacon address get stored** in the init code?

## 🛠️ Deliverables

1. **Foundry Scripts**: The three debug scripts above, fully implemented
2. **Test Results**: Verbose output showing exact byte layouts
3. **Documentation**: Clear explanation of the memory layout and byte arrangement
4. **Comparison Report**: Side-by-side comparison of expected vs actual init code
5. **Root Cause Analysis**: Specific identification of where our JavaScript differs

## 📝 Output Format

For each script, provide:
- Complete Solidity code
- Expected output format
- Instructions for running
- Interpretation of results

## 🎯 Success Criteria

The investigation is successful when we can:
1. **Generate the exact same init code hash** (`0x673b91cb887b557e9f95d3d449d50f9e130594cedf823272542df21fa656f247`) using Foundry
2. **Identify the specific byte-level differences** between our JS and Solidity implementations
3. **Provide actionable fixes** for our JavaScript code
4. **Verify the fix works** by matching the expected hash

## 🚀 Execution Instructions

1. Clone the credit-vault repository
2. Set up Foundry environment
3. Implement the debug scripts
4. Run tests with verbose output
5. Analyze results and provide findings
6. Create a detailed report with specific recommendations

This investigation should provide the definitive answers needed to fix our JavaScript implementation and achieve hash matching.
