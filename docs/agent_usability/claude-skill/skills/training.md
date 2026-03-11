# NOEMA: Training (Custom LoRA Models)

Train a LoRA to capture a specific character, style, or concept. Once trained, activate it via trigger words like any built-in LoRA.

Use training when: user wants consistent character across many generations, has a unique style to replicate, or mentions "train", "teach", "learn my style". Don't train for 2-3 images — use same seed instead. Check if a public LoRA already exists first.

---

## Step 1: Upload Dataset

```
POST https://noema.art/api/v1/upload/dataset
X-API-Key: {key}
Content-Type: application/json

{"name": "My Character Dataset", "imageCount": 20}
```

Upload images to the returned presigned URLs, or use the web interface. Returns `datasetId`.

**Dataset tips:** 10-50 images, varied poses/angles/lighting, 1024×1024 preferred, clear subjects.

---

## Step 2: Estimate Cost

```json
{"jsonrpc":"2.0","method":"trainings/calculate-cost","params":{
  "modelType": "FLUX",
  "steps": 1000
},"id":1}
```

---

## Step 3: Create Training

```json
{"jsonrpc":"2.0","method":"trainings/create","params":{
  "name": "My Character Sarah",
  "modelType": "SDXL",
  "datasetId": "dataset_abc123",
  "triggerWords": ["sarah_character", "sarahv1"],
  "steps": 1000,
  "loraRank": 16,
  "loraAlpha": 32
},"id":1}
```

| Model | Best for | Speed |
|-------|----------|-------|
| `FLUX` | Highest quality, photorealistic | Slow |
| `SDXL` | Balanced, large ecosystem | Medium |
| `SD1.5` | Fast, many existing LoRAs | Fast |

`steps`: 1000 default. More = better quality but longer. `loraRank`: 16 default (higher = more detail, larger file).

---

## Step 4: Monitor

```json
{"jsonrpc":"2.0","method":"trainings/get","params":{"id":"train_abc123"},"id":1}
```

Status: `pending` → `processing` (check `progress`) → `completed` / `failed` (can `trainings/retry`)

Training takes 30-60min typically.

---

## Step 5: Use It

Once `completed`, use trigger words in any generation with a matching checkpoint tool:

```json
{"jsonrpc":"2.0","method":"tools/call","params":{
  "name": "sdxl-base",
  "arguments": {"prompt": "sarah_character standing in a garden, soft lighting, detailed portrait"}
},"id":1}
```
