# NOEMA: Collections (Batch Generation)

Batch-generate many pieces, then curate the best. MCP shorthand in `Skill.md`.

**Lifecycle:** `CREATE → COOK → REVIEW → EXPORT`

Use when: 20+ pieces needed, want accept/reject curation, or need pause/resume. For 5-20 pieces without curation, use `input_batch` in `generation.md` instead.

Individual piece completions do not fire webhooks — use WebSocket or poll collection status (`collections/get`) for progress.

---

## Create

```json
{"jsonrpc":"2.0","method":"collections/create","params":{
  "name": "Fantasy Warriors",
  "targetCount": 50,
  "toolId": "make",
  "promptTemplate": "fantasy warrior, {variation}, detailed armor, epic lighting",
  "config": {"width":1024,"height":1024,"variations":["male warrior","female mage","elf rogue","dwarf paladin"]}
},"id":1}
```
Response: `{"id":"col_abc123"}`

---

## Cook / Control

| Action | MCP method | REST |
|--------|-----------|------|
| Start | `collections/cook/start` | `POST /api/v1/collections/{id}/cook/start` |
| Pause | `collections/cook/pause` | `POST .../cook/pause` |
| Resume | `collections/cook/resume` | `POST .../cook/resume` |
| Stop | `collections/cook/stop` | `POST .../cook/stop` |
| Status | `collections/get` | `GET /api/v1/collections/{id}` |

All take `{"id":"col_abc123"}` as params.

---

## Review

```json
{"jsonrpc":"2.0","method":"collections/review","params":{"collectionId":"col_abc123","pieceId":"piece_xyz","decision":"accepted"},"id":1}
```
`decision`: `"accepted"` | `"rejected"`

---

## Export

```json
{"jsonrpc":"2.0","method":"collections/export","params":{"id":"col_abc123","format":"zip","includeMetadata":true},"id":1}
```
REST: `POST /api/v1/collections/{id}/export`
