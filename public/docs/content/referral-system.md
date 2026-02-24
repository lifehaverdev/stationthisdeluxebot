# Referral System

NOEMA's referral program lets you earn passive Generation Credits by inviting new users. When someone funds their account through your referral link, 5% of their deposit is credited to your Referral Vault automatically.

---

## How It Works

Your referral link points to a unique **vault smart contract** deployed on-chain in your name. Any deposit routed through the vault triggers the 5% rebate — the funding fee that would otherwise go entirely to the protocol is split, with your share streamed to you.

| Platform | How to Share | How It Applies |
|----------|-------------|----------------|
| Web | `noema.art/r/<your-vault-name>` | New user lands on onboarding with your code pre-applied |
| API | `?ref=<vaultAddress>` query param | Programmatic deposits tagged to your vault |
| Telegram | `/ref` command | Coming soon |
| Discord | `/ref` slash command | Coming soon |

---

## Creating a Vault (Web)

1. **Open the account menu** — click your avatar or credit balance in the top-right corner
2. **Select "Add Referral Vault"**
3. **Choose a name** — this becomes part of your link: `noema.art/r/<name>`
4. **Confirm deployment** — NOEMA deploys your vault on-chain; a small gas fee is deducted from your credits
5. **Share your link** — anyone who funds through it earns you 5% of their deposit, indefinitely

---

## API Usage

Attach your vault to any deposit programmatically using the `ref` query parameter:

```
POST /api/v1/deposits?ref=<vaultAddress>
{
  "asset": "ETH",
  "amount": "0.5"
}
```

The response includes a `referralRebate` field confirming the amount credited to your vault.

---

## Stacking Earnings

Referral Vaults are the first layer of NOEMA's incentive stack. Combine them with Spell publishing and model contributions to earn up to an additional 19% on top of your 5% deposit rebate — up to 24% total of every deposit your network generates.

See [Tokenomics](#tokenomics) for the full breakdown.
