# HANDOFF: 2025-07-16 - Salt Mining Correction

## Work Completed
- **Error Diagnosis**: Successfully diagnosed the on-chain `execution reverted` error during `estimateGas`. The error code `0x58b49fe4` maps directly to `InvalidVaultAccountPrefix()`.
- **Root Cause Analysis**: Pinpointed the root cause: the off-chain `CREATE2` address prediction logic in `saltMiningWorker.js` is still not perfectly replicating the on-chain creation logic. This means our off-chain address has the prefix, but the address the contract *actually* generates does not.
- **Asset Integration**: Added the necessary `VaultAccount` contract bytecode to `src/core/contracts/abis/creditVaultAccount.bytecode.json`.
- **Performance Optimization**: Fixed a performance bottleneck in the salt miner by pre-calculating the `initCodeHash` outside the main loop, resolving the previous timeout errors.

## Current State
The referral vault creation flow is now failing instantly with a clear on-chain error.
- **Off-chain**: The `saltMiningWorker.js` successfully and quickly mines a salt that it *believes* will result in a `0x1152...` prefixed address.
- **On-chain**: The `estimateGas` call for the `createVaultAccount` function reverts with `InvalidVaultAccountPrefix()`. This proves the address the contract *would* generate does not match the prefix, indicating a mismatch between our off-chain prediction and the on-chain reality.

## Next Tasks

The core task is to **perfectly align the off-chain `getCreate2Address` calculation with the on-chain `create2` operation.** We will do this by creating a dedicated verification script.

1.  **Create a Verification Script (`scripts/debug/verify-create2.js`)**:
    - This script will not be part of the main application flow.
    - It will `require` the exact same `creationBytecode`, `creditVaultAddress`, `ownerAddress`, and a sample `salt`.
    - It will meticulously re-implement the `initCode` construction and `getCreate2Address` logic from our `saltMiningWorker`.
    - It will print the predicted address to the console.

2.  **Add an On-Chain "Compute" Function**:
    - Add a `public view` function to the `CreditVault` smart contract called `computeCreate2Address(address _owner, bytes32 _salt) returns (address)`.
    - This function will perform the exact same `create2` computation as `createVaultAccount` but will **not** execute a state change. It will simply return the computed address.

3.  **Run and Compare**:
    - Deploy the updated `CreditVault` contract with the new view function.
    - Run the verification script from step 1 to get our off-chain predicted address.
    - Call the new `computeCreate2Address` view function on the deployed contract with the same `_owner` and `_salt`.
    - **Compare the two addresses.** They must match exactly. Any difference will immediately point to the specific part of our off-chain logic (bytecode, argument encoding, hashing) that is incorrect.

4.  **Fix the Worker**:
    - Once the addresses match, copy the verified logic from the debug script back into `saltMiningWorker.js`.

This methodical approach removes all guesswork and will guarantee our off-chain and on-chain logic are perfectly synchronized.

## Changes to Plan
We are pivoting from debugging the live application flow to a more focused, isolated verification of the `CREATE2` cryptography. This is a necessary step to ensure correctness.

## Open Questions
None. This verification process will give us a definitive answer. 

---

## End-to-End Vault Creation Flow: Checklist & Debug Plan

### 1. Frontend Initiation
- User clicks "Create Referral Vault" and submits a name.
- Frontend calls `/api/v1/referral-vault/create`.

### 2. External API Layer
- `referralVaultApi.js` receives the request.
- Calls the internal API: `/internal/v1/data/actions/create-referral-vault`.

### 3. Internal API Layer
- `actionsApi.js` receives the request.
- Orchestrates:
  - Checks name uniqueness.
  - Fetches user and wallet info.
  - Calls `saltMiningService.getSalt(ownerAddress)`.

### 4. Salt Mining
- `saltMiningService` spawns a worker with:
  - `creditVaultAddress`
  - `ownerAddress`
  - `creationBytecode`
- Worker mines a salt that will produce a `0x1152...` address using the correct bytecode and constructor args.

### 5. Vault Deployment
- `actionsApi` calls `creditService.deployReferralVault(details)` with:
  - `masterAccountId`
  - `ownerAddress`
  - `vaultName`
  - `salt`
  - `predictedAddress`
- `creditService`:
  - Encodes the transaction data for `createVaultAccount(address, bytes32)`.
  - Calls `ethereumService.write(...)` to send the transaction.

### 6. On-Chain Transaction
- The operator wallet sends the transaction to the CreditVault contract.
- The contract:
  - Deploys the VaultAccount using CREATE2 with the provided salt and constructor args.
  - Checks the prefix.
  - Emits `VaultAccountCreated` event.

### 7. Backend Confirmation
- The backend listens for the `VaultAccountCreated` event (via webhook or polling).
- Updates the vault status in the DB.

### 8. Frontend Feedback
- The frontend receives status updates (polling or websocket).
- Shows success or error to the user.

---

## What Can Go Wrong?

- **Salt Mining**: Worker fails to find a salt (should be rare for 4 hex chars), or receives incorrect bytecode/args.
- **Transaction Preparation**: Incorrect encoding, wrong contract/ABI, operator wallet not funded/unlocked.
- **Transaction Submission**: RPC/network error, gas estimation fails, nonce issues.
- **On-Chain Execution**: Contract reverts (prefix check, duplicate vault, etc.), insufficient gas.
- **Event/Webhook Handling**: Event not received/processed, DB not updated.
- **API/Frontend**: API returns error, frontend does not handle gracefully.

---

## Pinpointing the Current Failure

- **Current Error**: `VAULT_CREATION_FAILED` with message `Failed to send vault deployment transaction.`
- **Timeouts**: Previous salt mining timeouts are resolved, but now the transaction is not being sent or is failing.
- **Next Steps:**
  1. **Log the mined salt and predicted address before sending the transaction.**
  2. **Log the transaction hash and any error returned by `ethereumService.write`.**
  3. **Check the operator wallet: funded, unlocked, correct private key.**
  4. **Check contract address and ABI.**
  5. **If the transaction is being sent, check the node or Etherscan for the actual revert reason.**

This checklist will guide the next debugging steps and ensure every layer is verified. 