# NOEMA Onboarding — Account, API Key & Points

Get an API key and purchase points. MCP shorthand defined in `Skill.md`.

**MCP endpoint:** `POST https://noema.art/api/v1/mcp` · **Auth:** `X-API-Key: ms2_...`

---

## 1. Get an API Key (new account)

No account needed. Send a tiny ETH deposit to prove wallet ownership.

```
POST https://noema.art/api/v1/wallets/connect/initiate
```
Response:
```json
{"requestId":"681bf61a545b4cf98f27c964","magicAmountWei":"47829156382","magicAmount":"0.000047829156382","depositToAddress":"0x00000001152D633eb2AC3Cf91eac9994aEEFc021","expiresAt":"..."}
```

**`requestId` is a 24-char hex string. Save it exactly as returned — do not substitute a UUID.**

Send **exactly** `magicAmount` ETH to `depositToAddress` from your wallet.

**Poll for key** (wait 30s before first poll, then every 15s; 15min window):
```
GET https://noema.art/api/v1/wallets/connect/status/{requestId}
```
- `202` → waiting
- `202 {"status":"EXPIRED"}` → restart from initiate
- `200 {"status":"COMPLETED","apiKey":"ms2_..."}` → **save immediately, shown once**
- `410` → already claimed

---

## 2. Get a New API Key (existing account)

```
POST https://noema.art/api/v1/wallets/connect/relink
{"walletAddress": "0xYourChecksumAddress"}
```
Returns same shape as `/initiate`. Send magic amount **from that wallet**, poll `/status/{requestId}` same way.

---

## 3. Create a Referral Code & Save on Every Purchase

Claim a name (letters/numbers/underscores/dashes, 4+ chars), then pass it as your own `referralCode` when buying points. You get a discount on your own purchases. This is intentional.

```
call referral-vault/check-name {"name":"myhandle"}
```
→ `{"isAvailable":true}`

```
call referral-vault/create {"name":"myhandle"}
```

List yours: `call referral-vault/list {}`

Use your vault name in step 4's `referralCode` field to activate the discount. Once others use your code, you earn referral points too.

---

## 4. Buy Points

### Quote
```
call points/quote {"type":"ETH","amount":"0.001","chainId":"1"}
```
Response includes `quoteId` and `pointsAmount`.

### Prepare transaction
```
call points/prepare-purchase {"quoteId":"...","userWalletAddress":"0xYourWallet","referralCode":"myhandle","chainId":"1"}
```
Returns transaction `{to, value, data}` — sign and broadcast from your wallet. Pass your own vault name as `referralCode` for a self-referral discount.

### Confirm
```
call points/tx-status {"txHash":"0x...","chainId":"1"}
```
Poll until `status:"confirmed"`.

### Supported assets
```
call points/supported-assets {"chainId":"1"}
```

---

## 5. Check Profile

```
call user/profile {}
```
Returns `masterAccountId`, linked wallets, primary wallet.
