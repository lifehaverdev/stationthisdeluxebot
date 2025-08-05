# Referral System

NOEMA’s referral program lets you earn passive Generation Credits by inviting new creators through each of our front-ends. A successful referral funnels 5 % of every top-up directly into **your** Referral Vault.

---

## 1. Overview

At a glance:

| Platform  | How to Share | User Journey |
|-----------|--------------|--------------|
| Telegram  | `/ref` command → get link | New user taps link → bot starts with your code |
| Web Canvas| `noema.art/r/yourVault`   | New user lands on onboarding page with your code |
| Discord   | `/ref` slash command      | New user joins server, link auto-applied |
| API       | `?ref=YOUR_VAULT` query param | Programmatic deposits tagged to your vault |

Every referral link points to **your unique Vault smart contract** on-chain. Deposits routed through the vault rebate the 5 % funding rate back to you.

---

## 2. Telegram *(coming soon)*

*We’ll update this section once the bot’s referral command ships. Stay tuned!*

---

## 3. Web Platform

Below is the current flow to create and share a vault from the Web Canvas.

1. **Open Account Menu** – Click the avatar/credits counter in the top-right corner.
2. **Create Vault** – Select “Add Referral Vault”.
3. **Choose a Name** – Pick something short; it becomes part of your link `noema.art/r/<name>`.
4. **Wait for Deployment** – NOEMA mines the CREATE2 salt and deploys your vault on-chain.  
   *You must hold enough credits to cover gas.*
5. **Share** – Your link is ready. Anyone who funds through it credits 5 % back to you.

> Screenshot 1 – Account dropdown with “Add Referral Vault”  
> Screenshot 2 – Name selection & gas cost prompt  
> Screenshot 3 – Success toast with generated link

*(Replace the placeholders above with actual images when available.)*

---

## 4. Discord *(coming soon)*

*We’ll document the `/ref` slash-command flow after the next bot release.*

---

## 5. API

Developers can attach a vault to any deposit by including the `ref` query parameter:

```
POST /internal/deposits?ref=<vaultAddress>
{
  "asset": "ETH",
  "amount": "0.5"
}
```

On success, the JSON response echoes the `referralRebate` credited to the vault owner.

Full OpenAPI schema coming soon.

---

## 6. Conclusion

Referral Vaults are the first layer of NOEMA’s incentive stack—simple to set up, powerful over time. Combine them with Spells and Model contributions to unlock up to an additional **19 %** of execution fees on top of your 5 % deposit rebate.

*Next up: API reference & advanced usage.* 