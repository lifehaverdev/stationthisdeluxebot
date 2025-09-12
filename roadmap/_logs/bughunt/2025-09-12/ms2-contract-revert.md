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

## Fix Implementation - Update 2
1. Previous Issues:
   - Quote calculation using wrong decimal base
   - Display amount calculation incorrect
   - Transaction amount not properly adjusted

2. Latest Changes:
   - Improved decimal handling in transaction data
   - Added detailed logging for token operations
   - Fixed amount conversion for both display and contract calls

3. Code Changes:
   ```javascript
   // Convert amount to human readable first
   const humanReadable = ethers.formatUnits(amount, 18);
   // Then convert to token's decimals
   const adjustedAmount = ethers.parseUnits(humanReadable, decimals).toString();
   ```

4. Transaction Analysis:
   - Function: contribute(address,uint256)
   - Selector: 0x8418cd99
   - Token: 0x98Ed411B8cf8536657c660Db8aA55D9D4bAAf820 (MS2)
   - Original Amount: 100000000000000 (0.0001 in 18 decimals)
   - Adjusted Amount: Will be converted to 9 decimals
   - Error: 0x7939f424 (unknown custom error)

5. Improved Logging:
   - Added token details to logs
   - Tracking original and adjusted amounts
   - Monitoring allowance values
   - Better error context

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
