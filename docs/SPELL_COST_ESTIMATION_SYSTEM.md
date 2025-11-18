# Spell Cost Estimation System

## Overview

The spell cost estimation system (`SpellsService.quoteSpell`) calculates expected costs by analyzing historical execution data from the `generationOutputs` collection.

## How It Works

### 1. **Spell Analysis**
- Fetches spell metadata (by ID or slug)
- Extracts the `steps` array from the spell definition
- Each step contains a `toolIdentifier` (or legacy `toolId`) that identifies which tool/service is used

### 2. **Historical Data Aggregation**
For each step in the spell:

```javascript
// MongoDB aggregation pipeline
{
  $match: { 
    serviceName: toolId,           // Match tool executions
    status: 'completed',           // Only completed executions
    durationMs: { $exists: true }, // Must have duration data
    costUsd: { $exists: true }     // Must have cost data
  },
  $sort: { responseTimestamp: -1 }, // Most recent first
  $limit: sampleSize,                 // Default: 10 samples
  $group: {
    _id: null,
    avgRuntimeMs: { $avg: '$durationMs' },
    avgCostUsd: { $avg: '$costUsd' }
  }
}
```

### 3. **Cost Calculation**
- **Average Cost USD**: Calculated from the last `sampleSize` (default 10) completed executions
- **Points Conversion**: `avgCostPts = avgCostUsd / USD_TO_POINTS_CONVERSION_RATE`
  - Conversion rate: `0.000337` (1 point = $0.000337)
- **Total Cost**: Sum of all step costs

### 4. **Return Value**
```javascript
{
  spellId: ObjectId,
  totalRuntimeMs: number,    // Sum of all step runtimes
  totalCostPts: number,       // Sum of all step costs in points
  breakdown: [
    {
      toolId: string,
      avgRuntimeMs: number,
      avgCostPts: number
    }
  ]
}
```

## Data Sources

### Generation Outputs Collection
The `generationOutputs` collection stores execution records with:
- `serviceName`: Tool identifier (e.g., "make", "effect", "chatgpt")
- `status`: Execution status ("completed", "failed", etc.)
- `durationMs`: Execution time in milliseconds
- `costUsd`: Cost in USD (stored as Decimal128)
- `responseTimestamp`: When the execution completed

### When Data is Missing
- **No execution history**: If a tool has never been executed, `avgCostUsd` = 0
- **Insufficient samples**: If fewer than `sampleSize` executions exist, uses available data
- **Missing fields**: Steps without `durationMs` or `costUsd` are skipped

## Edge Cases

### Zero Cost Spells
If a spell returns `totalCostPts: 0`, it means:
1. The spell has no execution history
2. The tools in the spell haven't been executed enough times
3. The execution records don't have cost data

**Current Behavior**: 
- Frontend validates and shows error if cost is 0
- Payment generation fails validation (amountPts must be > 0)

**Potential Solutions**:
- Use default/fallback costs for tools without history
- Require minimum cost threshold
- Allow free execution for spells with 0 cost (if intentional)

## Example Flow

1. User requests quote for spell "stylecaption"
2. System finds spell with 2 steps: ["chatgpt", "make"]
3. For "chatgpt": Queries last 10 ChatGPT executions → avg $0.05 → 148 pts
4. For "make": Queries last 10 Make executions → avg $0.10 → 297 pts
5. Total: 445 points
6. Frontend adds 20% buffer: 534 points for payment

## API Endpoint

**POST** `/api/v1/spells/:spellId/quote`

**Request**:
```json
{
  "sampleSize": 10  // Optional, defaults to 10
}
```

**Response**:
```json
{
  "spellId": "68e01958eb26adaf366d5326",
  "totalRuntimeMs": 5000,
  "totalCostPts": 445.2,
  "breakdown": [
    {
      "toolId": "chatgpt",
      "avgRuntimeMs": 2000,
      "avgCostPts": 148.4
    },
    {
      "toolId": "make",
      "avgRuntimeMs": 3000,
      "avgCostPts": 296.8
    }
  ]
}
```

