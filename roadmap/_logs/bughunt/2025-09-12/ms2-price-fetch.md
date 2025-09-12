# Bug Hunt: MS2 Token Price Fetch

## Issue
- MS2 token price not available through Alchemy API
- Need to fetch price directly from CoinGecko for accurate pricing
- Affects token price quoting functionality

## Root Cause
- MS2 is not a widely traded token on Ethereum, so Alchemy doesn't have reliable price data
- We need to use CoinGecko's price feed since MS2 has accurate price data there on Solana

## Implementation
1. ✅ Added MS2-specific price fetching logic to PriceFeedService
   - Added MS2 token addresses for ETH and SOL chains
   - Created private _getMS2Price() method to fetch from CoinGecko
   - Modified getPriceInUsd() to handle MS2 token specifically
2. ✅ Using CoinGecko API to get MS2 price when the token address matches MS2
   - Endpoint: /simple/price with station-this ID
   - Proper error handling and logging
3. ✅ Falling back to Alchemy for all other tokens
   - Original Alchemy price feed logic preserved
   - Clean separation of concerns between MS2 and other tokens

## Verification
- [ ] Test MS2 price fetch from CoinGecko
- [ ] Verify price matches Solana MS2 price
- [ ] Ensure other token prices still work through Alchemy
- [ ] Check error handling and fallbacks

## Follow-up Tasks
- Consider caching MS2 price to reduce API calls
- Monitor CoinGecko API rate limits
- Add price source to logging for better tracking
