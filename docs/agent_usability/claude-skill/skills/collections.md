# NOEMA: Collections (Batch Generation)

Collections batch-generate many pieces, then let you curate the best. Ideal for NFT collections, asset packs, or any 20+ piece project.

**Lifecycle:** `CREATE → COOK → REVIEW → EXPORT`

Use collections when: user needs 20+ pieces, wants accept/reject curation, or needs to pause/resume a long job. For 5-20 pieces without curation, use `input_batch` in `tools/call` instead.

---

## Create

```json
{"jsonrpc":"2.0","method":"collections/create","params":{
  "name": "Fantasy Warriors",
  "targetCount": 50,
  "toolId": "make",
  "promptTemplate": "fantasy warrior, {variation}, detailed armor, epic lighting",
  "config": {
    "width": 1024, "height": 1024,
    "variations": ["male warrior", "female mage", "elf rogue", "dwarf paladin"]
  }
},"id":1}
```

Response: `{ "id": "col_abc123" }`

---

## Cook (Generate)

```json
{"jsonrpc":"2.0","method":"collections/cook/start","params":{"id":"col_abc123"},"id":1}
```

Control mid-run:
- Pause: `collections/cook/pause`
- Resume: `collections/cook/resume`
- Stop: `collections/cook/stop`

Check progress: `{"jsonrpc":"2.0","method":"collections/get","params":{"id":"col_abc123"},"id":1}`

---

## Review

```json
{"jsonrpc":"2.0","method":"collections/review","params":{
  "collectionId": "col_abc123",
  "pieceId": "piece_xyz",
  "decision": "accepted"
},"id":1}
```

`decision`: `"accepted"` | `"rejected"`

---

## Export

```json
{"jsonrpc":"2.0","method":"collections/export","params":{
  "id": "col_abc123",
  "format": "zip",
  "includeMetadata": true
},"id":1}
```

---

## REST Equivalents

| Action | Endpoint |
|--------|----------|
| Create | `POST /api/v1/collections` |
| Start cook | `POST /api/v1/collections/{id}/cook/start` |
| Get status | `GET /api/v1/collections/{id}` |
| Review piece | `POST /api/v1/collections/{id}/review` |
| Export | `POST /api/v1/collections/{id}/export` |
