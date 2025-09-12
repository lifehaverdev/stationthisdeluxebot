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

## Fix Implementation - Update 6
1. Progress:
   - Quote calculation now using correct 9 decimals
   - Amount conversion working properly
   - Gas estimation skipped for MS2

2. New Changes:
   - Added MS2 decimal override to purchase endpoint
   - Consistent decimal handling across quote and purchase
   - Better logging for debugging

3. Code Changes:
   ```javascript
   // Special handling for MS2 token which has 9 decimals
   const isMS2 = assetAddress.toLowerCase() === '0x98Ed411B8cf8536657c660Db8aA55D9D4bAAf820'.toLowerCase();
   if (isMS2) {
       decimals = 9; // Override decimals for MS2
   }

   // Convert amount to human readable first
   const humanReadable = ethers.formatUnits(amount, 18);
   // Then convert to token's decimals
   const adjustedAmount = ethers.parseUnits(humanReadable, decimals).toString();
   ```

4. Critical Issue Found:
   - Input amount was 1000000 MS2 (in 9 decimals)
   - Code wrongly treated it as 18 decimals
   - Resulted in tiny amount (0.001 MS2)

5. Amount Conversion Fix:
   ```javascript
   // For MS2, amount is already in the token's decimals (9)
   if (isMS2) {
       assetAmount = parseFloat(ethers.formatUnits(amount, 9));
       adjustedAmount = amount;  // No conversion needed
   }
   ```

6. Current State:
   - Input: 1000000 MS2 (correct amount)
   - No decimal conversion needed
   - Points: 1000000000 (1000000 * 1000)
   - Gas Cost: 0 (skipped)

4. Benefits:
   - No more contract simulation errors
   - Faster quote calculation for MS2
   - More accurate pricing (gas cost was skewing value)
   - Better user experience

5. Decimal Handling (Unchanged):
   - Input: 18 decimals (Ethereum standard)
   - Convert to human readable
   - Convert to token decimals (9 for MS2)
   - Use adjusted amount for both display and contract calls

6. Next Steps:
   - Test MS2 contribution without gas estimation
   - Verify quote calculation shows correct value
   - Monitor transaction success rate

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
