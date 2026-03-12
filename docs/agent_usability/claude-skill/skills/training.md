# NOEMA: Training (Custom LoRA Models)

Train a LoRA to capture a character, style, or concept. Activate via trigger words like any built-in LoRA.

**Use when:** consistent character across generations, unique style to replicate, user says "train/teach/learn my style".
**Don't use when:** only 2-3 images (use same seed instead). Check public LoRAs first (`loras.md`).

Published LoRAs earn contributor rewards when used by others.

---

## Step 1: Upload Dataset

```
POST /api/v1/upload/dataset
{"name": "My Dataset", "imageCount": 20}
```
Upload images to returned presigned URLs. Returns `datasetId`.

**Tips:** 10-50 images, varied poses/angles/lighting, 1024×1024 preferred.

---

## Step 2: Estimate Cost

```json
{"jsonrpc":"2.0","method":"trainings/calculate-cost","params":{"modelType":"FLUX","steps":1000},"id":1}
```

---

## Step 3: Create

```json
{"jsonrpc":"2.0","method":"trainings/create","params":{
  "name": "My Character Sarah",
  "modelType": "SDXL",
  "datasetId": "dataset_abc123",
  "triggerWords": ["sarah_character"],
  "steps": 1000,
  "loraRank": 16,
  "loraAlpha": 32
},"id":1}
```

| Model | Best for |
|-------|----------|
| `FLUX` | Highest quality, photorealistic |
| `SDXL` | Balanced, large ecosystem |
| `SD1.5` | Fast |

`steps`: 1000 default. `loraRank`: 16 default (higher = more detail, larger file).

---

## Step 4: Monitor

```json
{"jsonrpc":"2.0","method":"trainings/get","params":{"id":"train_abc123"},"id":1}
```
Poll using pattern in `Skill.md` (wait 30min before first check). `processing` shows `progress`. `failed` → `trainings/retry`.

---

## Step 5: Use It

Once `completed`, use trigger words in any generation with a matching checkpoint tool:
```
call sdxl-base {"prompt": "sarah_character standing in a garden, soft lighting"}
```
