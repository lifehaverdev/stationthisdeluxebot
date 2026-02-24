# Training

NOEMA lets you train custom LoRA models on your own image datasets using GPU instances on VastAI. A trained LoRA captures the visual style, subject, or concept in your dataset and makes it available as a model you can apply in generation tools.

---

## What You Can Train

LoRA (Low-Rank Adaptation) fine-tuning adjusts a base model's weights to recognize and reproduce patterns in your training data. Common use cases include:

- **Subject training** — teach the model what a specific person, character, or object looks like
- **Style training** — capture an artistic style, aesthetic, or visual motif
- **Concept training** — encode a recurring theme or compositional pattern

---

## Preparing Your Dataset

### Uploading Images

Upload images from the Training section of your account. Supported formats are JPEG and PNG. A minimum of 10–15 images is recommended; 20–50 produces better results for most use cases.

Images should be:
- Consistent in subject or style
- Varied in composition, angle, and context (avoid near-duplicate shots)
- Clean and representative — training data quality directly affects model quality

### Automatic Captioning

NOEMA can automatically caption your dataset using JoyCaption. Captions describe each image in a format optimized for training and are stored alongside your images. You can review and edit individual captions before training begins.

Accurate captions help the model learn the right associations and improve output controllability.

### Control Image Groups

Control image groups let you annotate specific images with structured guidance — for example, marking which images represent a specific pose, lighting condition, or compositional element. This gives the training process additional signal beyond the caption text.

Control groups are optional but recommended for subject training where precise attribute learning matters.

---

## Starting a Training Job

1. **Select your dataset** from the Training panel
2. **Review captions** and edit any that are inaccurate
3. **Configure training parameters** — base model, training steps, learning rate, and LoRA rank (sensible defaults are provided)
4. **Start the job** — NOEMA provisions a VastAI GPU instance and begins training

Training typically takes 15–60 minutes depending on dataset size and step count. Credits are charged based on GPU time consumed.

---

## Monitoring Jobs

Active and completed training jobs appear in the Training panel. For each job you can see:

- Current status (queued, running, completed, failed)
- Elapsed time and estimated completion
- Training loss curve (updates in real time while running)
- GPU instance details

You will receive a notification when your job completes or if it fails.

---

## Using Your LoRA

Once training completes, your LoRA appears in your model library and is available as a parameter in compatible tools (such as VastMake GPU). Select it by ID when running a generation, and adjust the LoRA strength to control how strongly the model's style is applied.

Trained LoRAs are private by default. You can publish them to make them usable by other creators — if you do, you earn a share of execution fees each time someone uses your model.

---

## Tips

- **Caption quality matters more than dataset size.** 20 well-captioned images outperform 100 poorly described ones.
- **Match the base model to your goal.** Train on the same base model you plan to use for inference.
- **Start with fewer steps.** Overtrained LoRAs become rigid. Start at 1000–1500 steps and increase if the model isn't capturing what you want.
