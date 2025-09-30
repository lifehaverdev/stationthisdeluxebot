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
