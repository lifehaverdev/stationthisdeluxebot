# Environment Variables

ComfyUI Deploy requires several environment variables to be configured for proper operation. This document explains each variable and its purpose.

## Required Variables

| Variable | Description |
|----------|-------------|
| `POSTGRES_URL` | PostgreSQL connection URL for the database |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Public Clerk API key for authentication |
| `CLERK_SECRET_KEY` | Secret Clerk API key for authentication |
| `JWT_SECRET` | Secret key for JWT token generation and validation (generate using `openssl rand -hex 32`) |

## Storage Configuration

ComfyUI Deploy supports multiple storage backends for storing workflows, outputs, and other assets:

### R2/S3 Storage (Common Settings)
| Variable | Description |
|----------|-------------|
| `SPACES_ENDPOINT` | Endpoint URL for S3-compatible storage (e.g., `https://nyc3.digitaloceanspaces.com`) |
| `SPACES_ENDPOINT_CDN` | CDN endpoint URL for serving files (can be the same as `SPACES_ENDPOINT`) |
| `SPACES_BUCKET` | Bucket name (e.g., `comfyui-deploy`) |
| `SPACES_KEY` | Access key for storage service |
| `SPACES_SECRET` | Secret key for storage service |

### Cloudflare R2 Specific Settings
| Variable | Description |
|----------|-------------|
| `SPACES_REGION` | Set to `auto` for R2 |
| `SPACES_CDN_FORCE_PATH_STYLE` | Set to `true` for R2 |
| `SPACES_CDN_DONT_INCLUDE_BUCKET` | Set to `true` for R2 |

### DigitalOcean Spaces Specific Settings
| Variable | Description |
|----------|-------------|
| `SPACES_REGION` | Region for DigitalOcean Spaces (e.g., `nyc3`) |
| `SPACES_CDN_FORCE_PATH_STYLE` | Set to `false` for DigitalOcean |

### AWS S3 Specific Settings
| Variable | Description |
|----------|-------------|
| `SPACES_REGION` | AWS region (e.g., `us-east-1`) |
| `SPACES_CDN_DONT_INCLUDE_BUCKET` | Set to `false` for S3 |
| `SPACES_CDN_FORCE_PATH_STYLE` | Set to `true` for S3 |

## Example Configuration

For local development, create a `.env.local` file in the `web` directory with the following settings:

```
POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/postgres

NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

SPACES_ENDPOINT="http://localhost:4566"
SPACES_ENDPOINT_CDN="http://localhost:4566"
SPACES_BUCKET="comfyui-deploy"
SPACES_KEY="xyz"
SPACES_SECRET="aaa"

# Generate using -> openssl rand -hex 32
JWT_SECRET=your_generated_secret_here
```

For production deployment to Vercel, configure these environment variables in your Vercel project settings. 