> Imported from docs/comfyui-deploy/SETUP/DEPLOYMENT_GUIDE.md on 2025-08-21

# Deployment Guide

This guide provides instructions for deploying ComfyUI Deploy to production environments.

## Deploying with Vercel

ComfyUI Deploy is optimized for deployment on Vercel, which provides serverless functions, Edge Network CDN, and integrated CI/CD capabilities.

### Prerequisites

1. A [Vercel](https://vercel.com/) account
2. A PostgreSQL database (e.g., Vercel Postgres, Neon, Supabase)
3. An S3-compatible object storage service (e.g., AWS S3, Cloudflare R2, DigitalOcean Spaces)
4. A [Clerk](https://clerk.dev/) account for authentication

### Deployment Steps

1. Fork or clone the ComfyUI Deploy repository on GitHub

2. Create a new project in Vercel and connect it to your repository

3. Configure the build settings:
   - **Build Command**: `next build && bun run migrate-production`
   - **Install Command**: `npx bun@1.0.16 install`
   - **Output Directory**: `web/.next` (should be automatically detected)

4. Configure environment variables as described in [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md)

5. Deploy the project

### Database Migration

The build command includes `bun run migrate-production`, which runs database migrations during the build process. This ensures that your database schema is always up to date with your deployed code.

## Self-Hosting Options

While Vercel is the recommended deployment platform, ComfyUI Deploy can be self-hosted on any platform that supports Node.js applications.

### Docker Deployment

A Docker-based deployment is possible by:

1. Building the Next.js application:
   ```bash
   cd web
   bun i
   bun run build
   ```

2. Creating a Dockerfile for the production build:
   ```dockerfile
   FROM oven/bun:latest
   
   WORKDIR /app
   COPY web/.next /app/.next
   COPY web/public /app/public
   COPY web/package.json /app/package.json
   COPY web/next.config.mjs /app/next.config.mjs
   
   RUN bun install --production
   
   EXPOSE 3000
   
   CMD ["bun", "run", "start"]
   ```

3. Configuring environment variables for your Docker container

### ComfyUI Machine Deployment

After deploying the ComfyUI Deploy platform, you'll need to set up one or more ComfyUI machines:

1. Install the ComfyUI Deploy plugin in your ComfyUI instance
2. Register your machine in the ComfyUI Deploy dashboard
3. Set up appropriate networking to ensure your ComfyUI instances are accessible from the platform

## Scaling Considerations

For high-traffic deployments, consider:

1. Using a managed PostgreSQL service with appropriate scaling options
2. Setting up a CDN for your S3/R2 storage to reduce load on the storage backend
3. Deploying multiple ComfyUI machines and using the platform's load-balancing capabilities 