# Introduction

NOEMA is a self-hosted AI studio for generating, remixing, and publishing media. It runs across Telegram, Discord, and the web from a single backend — so your tools and credits work wherever you are.

---

## The Canvas

The web interface is built around a canvas. You add tool windows, configure their inputs, run them, and wire outputs into other tools. Everything you build can be saved as a workspace and shared with a link.

---

## Tools

Tools are the smallest unit of execution. Each tool wraps a single AI capability:

- **Text generation** — language models for writing, prompting, and transformation
- **Image generation** — text-to-image and image-to-image models
- **Image analysis** — captioning and interrogation models
- **Image decomposition** — layer extraction and editing
- **Video generation** — short clip generation from text or image

Tools expose typed inputs and outputs. Outputs from one tool can be connected directly to the inputs of another.

---

## Spells

A Spell is a saved chain of tools. You wire tools together on the canvas, expose the inputs that vary between runs, and save the arrangement. The result is a reusable, shareable pipeline.

Published Spells are discoverable by other users. When someone runs your Spell, you earn a share of the execution cost.

---

## Training

NOEMA lets you train custom LoRA models on your own image datasets. Upload images, generate captions automatically, and start a training job on a GPU via VastAI. Trained models appear in your library and can be applied in any compatible tool. You can publish your models for others to use and earn from each run.

---

## Collection Mode

Collection Mode is a generative pipeline for producing NFT collections at scale. Define a master prompt with trait slots, configure weighted trait values, and run the batch. NOEMA generates each item with a unique trait combination and stores the metadata. Review outputs individually, approve the ones that pass, and export a finished collection — images and metadata — ready for deployment.

---

## Credits

NOEMA runs on a credit system. Credits are purchased with crypto assets and consumed per tool execution. Supported assets and their funding rates are listed in the Pricing section.

Credits are tracked on-chain. You can view your balance and transaction history at any time from your account.

---

## Platforms

The same tools and credit balance are accessible across three platforms:

| Platform | Access |
|----------|--------|
| Web Canvas | [noema.art](https://noema.art) |
| Telegram | Via bot |
| Discord | Via slash commands |

API access is also available — see the API section for authentication and endpoint reference.
