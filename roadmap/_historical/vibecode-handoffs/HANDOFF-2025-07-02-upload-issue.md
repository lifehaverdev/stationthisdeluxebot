> Imported from vibecode/handoffs/HANDOFF-2025-07-02-upload-issue.md on 2025-08-21

# HANDOFF: 2025-07-02 - Upload Issue

## Work Completed
- **Initial Diagnosis**: Identified that the client-side was receiving a signed upload URL from the server but was not performing the actual file upload (`PUT` request) to that URL.
- **Client-Side Fix**: Patched `src/platforms/web/client/src/sandbox.js` to execute the `PUT` request to the signed URL provided by the backend.
- **CORS Debugging**: Encountered and began debugging a Cross-Origin Resource Sharing (CORS) error, which blocked the browser from sending the file to the Cloudflare R2 bucket.
- **CORS Policy Iteration**: Attempted several CORS policy configurations on the R2 bucket to explicitly allow requests from the production domain (`https://noema.art`) and local development (`http://localhost:4000`).
- **Header Refinement**: Modified the client-side `uploadFile` function multiple times to ensure the correct `Content-Type`, `Content-Length`, and `x-amz-*` headers were being sent with the `PUT` request.
- **Server-Side Refinement**: Updated the `generateSignedUploadUrl` function in `src/core/services/storageService.js` to better align with Cloudflare's R2/S3 pre-signed URL specifications, including adding a `ChecksumAlgorithm`.

## Upload Flow: Stages and Documentation

### Stage 1: Client Requests Signed Upload URL
- **Action:** Client POSTs to `/api/v1/storage/upload-url` with file name and content type.
- **Backend:** Calls `generateSignedUploadUrl()` which uses AWS SDK v3 to create a signed URL for a `PutObjectCommand`.
- **References:**
  - [Cloudflare R2: Using presigned URLs](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/#presigned-urls)
  - [AWS SDK v3: S3Client and getSignedUrl](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-s3/)
- **Status:** ✅ Working. Client receives a signed URL and a permanent URL.

### Stage 2: Client Uploads File to R2 Using Signed URL
- **Action:** Client PUTs the file to the signed URL, sending only the `Content-Type` header.
- **References:**
  - [Cloudflare R2: CORS configuration](https://developers.cloudflare.com/r2/buckets/cors/)
  - [Cloudflare R2: S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/)
  - [AWS S3: Browser-based uploads and signed URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html)
- **Status:** ❌ Failing. R2 responds with `401 Unauthorized` to both browser and curl PUT requests.
- **Symptoms:**
  - Preflight OPTIONS request returns 204 (CORS OK).
  - Actual PUT returns 401 Unauthorized, even with minimal headers.

### Stage 3: File Should Be Accessible at Permanent URL
- **Action:** If upload succeeds, file is available at the permanent URL for display in the sandbox.
- **Status:** ⏳ Not reached due to failure in Stage 2.

## Current Blocker: Stage 2 (PUT to R2 401 Unauthorized)
- **What we've tried:**
  - Minimal headers (only `Content-Type`).
  - Both browser and curl PUTs fail with 401.
  - Credentials are confirmed correct and have write access.
  - Signed URL is generated using AWS SDK v3, with `region: 'auto'`, correct endpoint, and only `host` as signable header.
  - `ChecksumAlgorithm: 'CRC32'` is currently set in the PutObjectCommand (may not be needed).

## Next Steps (Research-Driven)
1. **Review Cloudflare R2 Documentation:**
   - Confirm if `ChecksumAlgorithm` is required or should be omitted for browser/curl uploads.
   - Double-check the required/allowed headers for signed PUTs from browser/curl.
   - [Cloudflare R2: S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/)
   - [Cloudflare R2: Using presigned URLs](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/#presigned-urls)
2. **Review AWS SDK v3 Documentation:**
   - Ensure `getSignedUrl` usage matches R2's S3 compatibility.
   - [AWS SDK v3: S3Client and getSignedUrl](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-s3/)
3. **Check for Known Issues:**
   - Search for issues with R2, presigned URLs, and browser/curl uploads (GitHub, Cloudflare Community, Stack Overflow).
4. **Test Without `ChecksumAlgorithm`:**
   - Remove `ChecksumAlgorithm: 'CRC32'` from the PutObjectCommand and retest.
5. **Verify S3 Client Configuration:**
   - Confirm `region: 'auto'` and correct endpoint are set in S3 client.
   - [Cloudflare R2: SDK configuration](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/#sdk-configuration)

## Open Questions
- Is `ChecksumAlgorithm` required for R2 PUTs via presigned URL, or does it break compatibility?
- Are there any required headers that must be included in the signature for browser/curl uploads?
- Are there any Cloudflare-specific settings or permissions that could cause a 401 even with correct credentials and signature?
- Is there a way to get more detailed error messages from R2 for failed PUTs?

## Changes to Plan
None. We are shifting to a more research-driven, documentation-first approach to avoid blind trial and error.

## References
- [Cloudflare R2 Documentation](https://developers.cloudflare.com/r2/)
- [Cloudflare R2: S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/)
- [Cloudflare R2: Using presigned URLs](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/#presigned-urls)
- [AWS SDK v3 Documentation](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-s3/) 