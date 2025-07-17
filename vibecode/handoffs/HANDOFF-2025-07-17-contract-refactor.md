# HANDOFF: 2025-07-17

## Work Completed
- Initiated systematic refactor of all smart contract interactions to use new Foundation/CharteredFund ABIs and naming conventions.
- Performed a full codebase search for all contract function calls, ABI imports, and event handling related to the old contracts.
- Began detailed inventory of all affected code locations (see below).

## Current State
The following files and lines have been identified as containing contract interactions that must be updated:

### 1. ABI Imports and Contract Config
- `src/core/contracts/index.js`: Imports `creditVaultAbi`, `creditVaultAccountAbi` (to be replaced with `foundation.json`, `charteredFund.json`).
- `src/core/services/alchemy/creditService.js`: Uses `creditVaultAbi`, `creditVaultAddress` in config and throughout service.
- `src/core/services/alchemy/saltMiningService.js`: Loads `creditVaultAccount.bytecode.json` and references `creditVaultAddress`.
- `src/core/services/alchemy/saltMiningWorker.js`: Uses `creditVaultAddress` and `VaultAccount` bytecode.

### 2. Function Calls (Old → New)
- `createVaultAccount` → `charterFund`
- `computeVaultAccountAddress` → `computeCharterAddress`
- `confirmCredit` → `commit`
- `deposit`/`depositFor` → `contribute`/`contributeFor`
- `withdrawTo` → `remit`
- `withdraw` → `requestRescission`
- `recordWithdrawalRequest` → `recordRescissionRequest`
- `recordWithdrawal` → `recordRemittance`
- `blessEscrow` → `allocate`

### 3. Event Handling (Old → New)
- `DepositRecorded` → `ContributionRecorded`
- `CreditConfirmed` → `CommitmentConfirmed`
- `VaultAccountCreated` → `FundChartered`
- `WithdrawalRequested` → `RescissionRequested`
- `WithdrawalProcessed` → `RemittanceProcessed`
- `UserWithdrawal` → `ContributionRescinded`

#### Example Affected Code (partial, see full search results for more):
- `src/core/services/alchemy/creditService.js`: Handles and decodes events, calls contract functions, references `vaultAccount`.
- `src/core/services/alchemy/saltMiningService.js`/`saltMiningWorker.js`: Handles vault account creation logic.
- `src/core/services/db/alchemy/creditLedgerDb.js`, `src/api/internal/creditLedgerApi.js`: Handles withdrawal request logic (DB/API layer, may reference old event/function names).

## Next Tasks
- Systematically update all ABI imports to use `foundation.json` and `charteredFund.json`.
- Refactor all contract function calls and event handling to use new names and signatures.
- Update all references to contract addresses/configuration.
- Update database/model logic if any schema or field names reference old contract concepts.
- Update and run tests for all affected flows.
- Document all changes and update this handoff as work progresses.

## Changes to Plan
- None yet. All work is proceeding according to the refactor plan and AGENT_COLLABORATION_PROTOCOL.md.

## Open Questions
- Are there any frontend or workflow scripts that directly interact with the contracts and need to be included in this refactor?
- Are there any additional event types or contract functions not covered in the mapping table that should be updated? 