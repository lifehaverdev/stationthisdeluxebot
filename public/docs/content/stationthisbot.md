# StationThisBot

NOEMA is available as a bot on both Telegram and Discord. The same tools, credits, and account work across both platforms — find it at **@stationthisbot** on either.

---

## Getting Started

### Telegram

1. Open [@stationthisbot](https://t.me/stationthisbot) and send `/start`
2. Connect your wallet with `/wallet`
3. Purchase credits with `/buypoints`
4. Browse available tools with `/tools`, then run one

### Discord

1. Add @stationthisbot to your server or find it in a server where it's installed
2. Run `/account` to set up your account
3. Connect your wallet with `/wallet`
4. Purchase credits with `/buypoints`

---

## Connecting a Wallet

Your wallet links your on-chain credits to your bot account. Two methods are available:

**Magic Amount (recommended)**
1. Run `/wallet`
2. The bot gives you a specific ETH amount and a deposit address
3. Send that exact amount from the wallet you want to link
4. Once confirmed on-chain, your wallet is linked and your account is ready

**Approval Request**
1. Run `/link <walletAddress>`
2. A request is sent to the account already associated with that wallet
3. Once approved, the wallet is linked to your bot account

---

## Buying Credits

Run `/buypoints` to fund your account. The bot shows you the current exchange rate and accepts ETH and a range of supported tokens. Enter a referral vault address during checkout to direct the funding fee back to the vault owner.

Your current balance is always visible via `/account` or `/status`.

---

## Running Tools

Every tool in the NOEMA registry is available as a slash command. The command name matches the tool (e.g., `/vastmake`, `/joycaption`, `/chat`).

**Text prompt:**
```
/vastmake a cinematic portrait, golden hour, shallow depth of field
```

**With an image:** reply to an image or attach one alongside your command. The bot detects the image automatically.

Run `/tools` to browse everything available, with descriptions and usage notes.

### /again

Repeats your last generation with a new random seed. Useful for iterating on a result without retyping the prompt.

---

## Settings

Run `/settings` to view and adjust your default parameters for each tool — resolution, steps, CFG scale, strength, and more. Settings are saved per tool and applied automatically on every generation.

Override any setting inline by including it in your command.

---

## Mods (LoRAs)

Run `/mods` to browse available LoRA models. Select one to apply it to your next generation, or configure a default in `/settings`.

---

## Spells

**Telegram:** Run `/spell` to open the spellbook. Browse published spells, view their parameters, and run them directly.

**Discord:** Use `/cast <spell-slug>` to run a spell by its slug. Pass parameter overrides inline.

```
/cast epic-landscape-vfx input_prompt:misty mountain valley at dawn
```

---

## Account and Credits

| Command | What it does |
|---------|-------------|
| `/account` | Dashboard: balance, wallet status, history, referral earnings |
| `/status` | Quick summary: balance, level, active tasks |
| `/buypoints` | Purchase credits |
| `/wallet` | Connect or view linked wallets |

---

## Group Usage

The bot works in group chats. Server or group admins can configure a sponsor wallet — generations from group members are charged to the sponsor's account rather than the individual user's balance.

---

## Tips

- **Reply to your own image** before running an image-based tool — the bot picks it up automatically
- **`/again` is fast** — use it to explore variation without re-entering a prompt
- **Settings persist** — configure `/settings` once per tool and every generation uses your preferences
- **Credits are shared** across Telegram, Discord, and the web canvas — top up in one place, use anywhere
