# Bug Hunt: MS2 Contract Contribution Revert

## Issue
- Contract reverts when trying to contribute MS2 tokens
- Error occurs during gas estimation
- Custom error code: 0x7939f424

## Root Cause Analysis
1. Transaction Details:
   - Contract: 0x01152530028bd834EDbA9744885A882D025D84F6
   - Function: contribute(address token, uint256 amount)
   - Token: 0x98Ed411B8cf8536657c660Db8aA55D9D4bAAf820 (MS2)
   - Amount: 1000000000000000 (0.001 MS2)
   - From: 0x428Bea9Fd786659c84b0bD62D372bb4a482aF653

2. Error Context:
   - Gas estimation fails with custom error
   - Contract reverts before execution
   - Both 'contribute' and 'donate' modes fail
   - Using fallback gas estimation

## Potential Causes

1. Token Decimals Mismatch
   - Contract expects 18 decimals
   - MS2 token has 9 decimals (from TOKEN_CONFIG)
   - Amount being sent: 1000000000000000 (0.001 with 18 decimals)
   - This would be a much larger amount in 9 decimals

2. Allowance/Balance Issues
   - Contract checks allowance before gas estimation
   - Amount may exceed balance or allowance
   - Need to verify token balance and allowance

3. Contract State
   - Contract may be paused
   - User may be blacklisted
   - Contribution limits may be enforced

## Fix Implemented
1. Root Cause Confirmed:
   - Input amount was using 18 decimals (Ethereum standard)
   - MS2 token uses 9 decimals
   - Amount was not being adjusted for token decimals before contract call

2. Changes Made:
   - Added decimal adjustment in pointsApi.js
   - Convert amount from 18 decimals to human readable
   - Convert back to token's specific decimals
   - Apply adjustment to both approval and contribution calls

3. Code Changes:
   ```javascript
   const adjustedAmount = ethers.parseUnits(
       ethers.formatUnits(amount, 18), // Convert from 18 decimals to human readable
       decimals // Convert to token's decimals
   ).toString();
   ```

## Verification Steps
1. Test MS2 contribution with small amount
2. Verify gas estimation succeeds
3. Check approval transaction works
4. Confirm contribution transaction succeeds
5. Monitor logs for correct decimal conversion

## Impact
- Users cannot contribute MS2 tokens
- Points quoting shows negative USD value due to gas cost
- Both contribute and donate modes affected
