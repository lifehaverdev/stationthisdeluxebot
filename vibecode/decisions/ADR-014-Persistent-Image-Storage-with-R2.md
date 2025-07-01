# ADR-014: Persistent Image Storage with Cloudflare R2

## Context

The current system has two major limitations regarding image handling:
1.  **Expiring URLs:** The Telegram platform provides temporary, expiring URLs for user-uploaded images. This breaks long-term functionality like spell sharing, character consistency, and model training, which rely on persistent access to image inputs.
2.  **No Web Upload:** The web interface lacks a mechanism for users to upload their own images for use in generation or as training parameters. This severely limits the web platform's utility and creates a feature disparity with other platforms.

A unified, robust image persistence layer is required to ensure feature stability and provide a consistent user experience across all clients (Web, Telegram, etc.).

## Decision

We will implement a centralized storage service using **Cloudflare R2** as the backend object store. All user-provided images will be uploaded to a dedicated R2 bucket, and a permanent, CDN-backed URL will be generated and stored for each asset.

The implementation will follow these principles:
1.  **S3-Compatible API:** We will use an S3-compatible SDK to interact with R2, ensuring broad library support and standard practices.
2.  **Signed URLs for Uploads:** The web client will request a secure, pre-signed URL from the backend to upload files directly to R2. This reduces load on our server and improves security by granting temporary, specific permissions for the upload operation.
3.  **Server-Side Rehosting for Platforms:** For platforms like Telegram that don't support direct client uploads, the backend will fetch the image and re-host it to R2, replacing the temporary link with a permanent one.

## Consequences

### Positive
- **URL Persistence:** Eliminates the problem of expiring links, making features that depend on them reliable.
- **Unified System:** Creates a single, consistent pipeline for handling images from any platform.
- **Cost-Effective:** Cloudflare R2 has zero egress fees, which is highly advantageous for a media-heavy application, minimizing costs associated with serving images.
- **Performance:** Leveraging Cloudflare's global CDN for asset delivery will provide fast load times for users worldwide.
- **Feature Parity:** Enables the implementation of a file upload feature on the web platform.

### Negative / Risks
- **New Dependency:** Introduces a dependency on Cloudflare R2, including its availability and pricing model.
- **Refactoring Effort:** Existing code that handles Telegram media links must be refactored to use the new storage service.
- **Security Overhead:** Requires careful management of credentials and strict implementation of signed URLs and bucket policies to prevent unauthorized access.

## Alternatives Considered

1.  **AWS S3:**
    - **Pros:** Highly mature, feature-rich, and reliable industry standard.
    - **Cons:** Incurs data egress fees, which can become very expensive and unpredictable as image serving requests grow.

2.  **Local Filesystem Storage:**
    - **Pros:** Simple to implement for a single-server setup. No external dependencies.
    - **Cons:** Does not scale horizontally. Complicates backups, deployments, and disaster recovery. Serving files from the application server is less performant and secure than using a dedicated object store and CDN.

Cloudflare R2 was chosen as it provides the best balance of S3-compatibility, cost-effectiveness (no egress fees), and high performance through its integrated CDN. 