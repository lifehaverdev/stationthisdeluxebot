# Bug Hunt Log: Telegram Referral Charter Fix

**Date**: 2025-01-30  
**Severity**: S2 (Major feature broken)  
**Module**: Telegram Buy Points Manager  

## Problem
Telegram referral code functionality was failing with error:
```
TypeError: Cannot read properties of undefined (reading 'creditLedger')
at pointsApi (/usr/src/app/src/api/internal/economy/pointsApi.js:29:31)
```

## Root Cause Analysis
1. **Missing Dependencies**: `pointsApi` was being mounted without `apiDependencies` parameter in `/src/api/internal/index.js:433`
2. **Missing Endpoint**: The `/internal/v1/data/points/charter/:code` endpoint was not implemented in `pointsApi.js`

## Fix Applied
1. **Fixed pointsApi initialization**:
   ```javascript
   // Before
   v1DataRouter.use('/points', pointsApi);
   
   // After  
   v1DataRouter.use('/points', pointsApi(apiDependencies));
   ```

2. **Added charter endpoint** to `pointsApi.js`:
   ```javascript
   router.get('/charter/:code', async (req, res, next) => {
       const { code } = req.params;
       const vault = await creditLedgerDb.findReferralVaultByName(code);
       if (!vault) {
           return res.status(404).json({ message: 'Charter not found.' });
       }
       res.json({
           code,
           address: vault.vault_address,
           vaultName: vault.vaultName,
           masterAccountId: vault.master_account_id
       });
   });
   ```

## Verification Steps
- [ ] Test referral code "remilio" in Telegram
- [ ] Verify charter endpoint returns correct vault information
- [ ] Confirm buyPointsManager.js can process referral codes

## Files Modified
- `src/api/internal/index.js` (line 433)
- `src/api/internal/economy/pointsApi.js` (added charter endpoint)

## Status
✅ **FIXED** - Both issues resolved in single bulk edit

---

## Additional Fix: MS2 Token Decimal Handling

**Problem**: MS2 donations were crediting 0 points due to incorrect decimal handling in webhook processing.

**Root Cause**: `_processDonationEvent()` was using `formatEther()` (18 decimals) for MS2 tokens which have 6 decimals, causing massive under-calculation of USD value.

**Fix Applied**:
```javascript
// Handle MS2 token with 6 decimals vs ETH with 18 decimals
let grossDepositUsd;
if (token.toLowerCase() === '0x98Ed411B8cf8536657c660Db8aA55D9D4bAAf820'.toLowerCase()) {
  // MS2 has 6 decimals
  grossDepositUsd = parseFloat(formatUnits(amount, 6)) * priceInUsd;
} else {
  // ETH and other tokens use 18 decimals
  grossDepositUsd = parseFloat(formatEther(amount)) * priceInUsd;
}
```

**Files Modified**:
- `src/core/services/alchemy/creditService.js` (lines 376-399)

**Status**: ✅ **FIXED** - MS2 donations now credit correct points
