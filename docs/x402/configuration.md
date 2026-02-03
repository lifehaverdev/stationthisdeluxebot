# x402 Configuration

## Environment Variables

### Required

```bash
# Enable x402 payment protocol
X402_ENABLED=true

# Address to receive USDC payments (your treasury/foundation wallet)
X402_RECEIVER_ADDRESS=0x428Bea9Fd786659c84b0bD62D372bb4a482aF653

# Network for payments (CAIP-2 format)
# Base Mainnet: eip155:8453
# Base Sepolia: eip155:84532
X402_NETWORK=eip155:8453

# CDP (Coinbase Developer Platform) API credentials
# Required for facilitator authentication on mainnet
CDP_API_KEY_ID=organizations/xxxx/apiKeys/xxxx
CDP_API_KEY_SECRET=<base64-encoded-secret>
```

### Optional

```bash
# Override USDC contract address (usually not needed)
# Base Mainnet: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
# Base Sepolia: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
X402_USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
```

## Getting CDP Credentials

1. Go to [Coinbase Developer Platform](https://portal.cdp.coinbase.com/)
2. Create or select a project
3. Navigate to API Keys
4. Create a new API key with x402 permissions
5. Copy the Key ID and Secret

**Important**: The secret is a base64-encoded string (ends with `==`). Do not wrap it in quotes in your `.env` file.

```bash
# Correct
CDP_API_KEY_SECRET=abc123xyz789==

# Wrong
CDP_API_KEY_SECRET="abc123xyz789=="
```

## Network Configuration

### Base Mainnet (Production)

```bash
X402_NETWORK=eip155:8453
X402_USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
```

### Base Sepolia (Testing)

```bash
X402_NETWORK=eip155:84532
X402_USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e
```

**Note**: CDP Facilitator supports Base Mainnet. For Sepolia testing, you may need to use the x402.org facilitator (which has limited support).

## Receiver Address Setup

The `X402_RECEIVER_ADDRESS` is where all USDC payments are sent. This should be:

1. A wallet you control (EOA or multisig)
2. On the same network as configured
3. Capable of receiving USDC

For production, consider using:
- A Gnosis Safe multisig
- A dedicated treasury wallet
- An address with monitoring/alerting

## Code Configuration

### Middleware Initialization

The middleware is created in `src/api/external/index.js`:

```javascript
const x402Config = {
  receiverAddress: process.env.X402_RECEIVER_ADDRESS,
  network: process.env.X402_NETWORK || 'eip155:8453'
};

const x402Middleware = createX402Middleware(x402Config);
```

### API Router Setup

```javascript
const x402GenerationRouter = createX402GenerationApi({
  toolRegistry: dependencies.toolRegistry,
  internalApiClient: dependencies.internal.client,
  x402PaymentLogDb: dependencies.db?.data?.x402PaymentLog,
  receiverAddress: process.env.X402_RECEIVER_ADDRESS,
  network: process.env.X402_NETWORK || 'eip155:8453'
});

router.use('/x402', x402Middleware, x402GenerationRouter);
```

### Service Initialization

The x402PaymentLogDB is initialized in `src/core/services/index.js`:

```javascript
const X402PaymentLogDB = require('./db/x402PaymentLogDb');
const x402PaymentLog = new X402PaymentLogDB(logger);
await x402PaymentLog.ensureIndexes();
```

## Pricing Configuration

Tool pricing is configured in the tool registry. Each tool needs a `costingModel`:

```javascript
// Static pricing (per request)
costingModel: {
  rateSource: 'static',
  staticCost: {
    amount: 0.01,  // USD per request
    unit: 'request'
  }
}

// API-based pricing (with cost table)
costingModel: {
  rateSource: 'api'
},
metadata: {
  costTable: {
    'dall-e-3': {
      '1024x1024': { standard: 0.04, hd: 0.08 }
    }
  }
}

// Machine-time pricing (per second)
costingModel: {
  rateSource: 'machine',
  rate: 0.001,     // USD per second
  unit: 'second'
},
metadata: {
  estimatedDurationSeconds: 30
}
```

## Platform Markup

A 20% markup is applied to all costs:

```javascript
// src/core/services/x402/X402PricingService.js
const PLATFORM_MARKUP = 0.20;
const MINIMUM_CHARGE_USD = 0.01;

// Example:
// Base cost: $0.01
// Markup:    $0.002 (20%)
// Total:     $0.012
```

## Database Configuration

x402 payment logs are stored in the `noema` database:

```javascript
// Collection: x402_payment_log
// Indexes:
{
  signature_hash: { unique: true },  // Replay protection
  payer: 1,                          // Query by payer
  tx_hash: { sparse: true },         // Query by settlement tx
  status: 1, created_at: -1,         // Status queries
  created_at: -1,                    // Time-based queries
  settled_at: { sparse: true }       // Settlement analytics
}
```

## Disabling x402

To disable x402 without removing configuration:

```bash
X402_ENABLED=false
```

When disabled:
- Middleware sets `req.x402 = null` and passes through
- API endpoints still work but always return 402
- No payment processing occurs
