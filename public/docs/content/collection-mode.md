# Collection Mode

Collection Mode is NOEMA's generative NFT pipeline. It lets you define a generation setup once — a Spell or tool, a master prompt, and a randomness configuration — then run it automatically at scale to produce a trait-laden collection of outputs, review them, and export a finished NFT collection ready for market.

---

## Overview

The pipeline has four stages:

1. **Configure** — choose your Spell or tool, set parameters, write the master prompt
2. **Generate** — run the batch automatically; randomness variations produce distinct outputs
3. **Review** — approve or reject each output individually
4. **Export** — package approved outputs with trait metadata into a deployable NFT collection

---

## Stage 1: Configure

### Choose a Spell or Tool

Start by selecting what will generate each item in your collection. You can use any published Spell or any individual tool. Spells are recommended when your pipeline involves multiple steps (e.g., prompt enrichment → image generation).

### Master Prompt

The master prompt is the base text that drives generation. It supports variable slots — placeholders that get replaced with randomly sampled trait values on each run.

Example:
```
a portrait of [[subject]], wearing [[clothing]], in a [[setting]], [[lighting]] lighting
```

Each `[[slot]]` maps to a trait category you define below.

### Trait Definitions

For each slot in your master prompt, define a trait category with a list of possible values and optional weights:

| Trait | Values | Weight |
|-------|--------|--------|
| subject | warrior, mage, rogue | equal |
| clothing | armor, robe, leather jacket | 50%, 30%, 20% |
| setting | forest, city rooftop, cave | equal |
| lighting | dramatic, soft, neon | equal |

The generator samples from these lists on each run, producing unique prompt combinations and their corresponding metadata.

### Collection Size

Set how many outputs to generate. Each run consumes credits at the per-tool rate.

### Tool Parameters

Any non-prompt parameters (model, resolution, seed behavior, etc.) are set here and applied uniformly across the collection.

---

## Stage 2: Generate

Once configured, start the batch run. NOEMA queues all generations and executes them automatically. Progress is shown in real time — you can leave and return; the batch continues in the background.

Each output is produced with a unique trait combination. The full metadata record (trait names, values, prompt used, tool parameters, seed) is stored alongside every output.

---

## Stage 3: Review

After generation completes, every output enters the review queue. You step through each one and mark it as approved or rejected. Rejected outputs are excluded from the final export but remain visible for reference.

You can regenerate rejected outputs individually if you want to retry a specific trait combination.

---

## Stage 4: Export

Approved outputs are packaged into a standard NFT collection format:

- **Images** — all approved outputs as individual files
- **Metadata** — one JSON metadata file per output, with trait attributes in standard format (compatible with OpenSea, Zora, and most ERC-721 marketplaces)
- **Collection manifest** — a top-level summary with collection name, size, and trait distribution stats

The export is available as a ZIP download. From there, upload to your storage of choice and deploy your contract.

---

## Tips

- **Test with a small batch first.** Run 5–10 outputs before committing to a full collection size, to validate your prompt and trait setup.
- **Use weighted traits intentionally.** Rarity comes from weights. Think about which traits should be rare before you generate.
- **Review with fresh eyes.** Step away after generation before reviewing — it helps you evaluate outputs more objectively.
