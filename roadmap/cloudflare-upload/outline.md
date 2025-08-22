# Cloudflare Upload — Outline

## Problem Statement
Current upload flow relies on public S3 buckets; lacks privacy and incurs high egress cost.

## Vision
Streamlined client → Cloudflare R2 upload with signed URLs, private-by-default objects, and CDN delivery.

## Acceptance Criteria
- Generate time-limited signed upload URL via backend (`/api/uploads/sign`)
- Frontend `UploadService.uploadFile(file)` streams to R2 signed URL with progress
- Objects stored under `/userUploads/<userId>/yyyy/mm/dd/<uuid>`
- Post-upload callback stores metadata row with privacy flag
- CDN link exposes only authorised files (signed or token-based)

## Key Milestones
| Milestone | Description | Target Sprint |
|-----------|-------------|---------------|
| R2 bucket & credentials | Terraform setup, env vars | 2025-08-22 |
| Signed URL API | Internal & external route | 2025-08-22 |
| JS UploadService | Progress events, retry logic | 2025-08-29 |
| Privacy wrappers | Token-based access control | 2025-09-05 |

## Dependencies
- Credential management in config service
- Optional: JWT token minting for private downloads
