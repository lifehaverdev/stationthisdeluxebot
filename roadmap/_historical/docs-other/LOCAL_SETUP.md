> Imported from docs/comfyui-deploy/SETUP/LOCAL_SETUP.md on 2025-08-21

# ComfyUI Deploy Local Setup

This guide provides instructions for setting up ComfyUI Deploy locally for development.

## Prerequisites

- [Bun](https://bun.sh/) (JavaScript runtime and package manager)
- [Docker](https://www.docker.com/) (for database and storage services)
- [Git](https://git-scm.com/)
- [OpenSSL](https://www.openssl.org/) (for generating secrets)
- [Clerk](https://clerk.dev/) account (for authentication)

## Setup Steps

1. Clone the repository:
   ```bash
   git clone https://github.com/BennyKok/comfyui-deploy
   ```

2. Navigate to the web directory:
   ```bash
   cd comfyui-deploy/web
   ```

3. Install dependencies:
   ```bash
   bun i
   ```

4. Start Docker services:
   ```bash
   # Ensure Docker is running
   ```

5. Create a local environment file:
   ```bash
   cp .env.example .env.local
   ```

6. Generate a JWT secret:
   ```bash
   openssl rand -hex 32
   ```
   
7. Update the `JWT_SECRET` in your `.env.local` file with the generated value

8. Set up Clerk authentication:
   - Create a Clerk application at https://dashboard.clerk.dev/
   - Get your development API keys
   - Add your Clerk keys to `.env.local`:
     - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
     - `CLERK_SECRET_KEY`

9. Start the database development service:
   ```bash
   bun run db-dev
   ```

10. Apply initial database migrations:
    ```bash
    bun run migrate-local
    ```

11. Start the development server:
    ```bash
    bun dev
    ```

## Database Schema Changes

When making changes to the database schema:

1. Generate migration files:
   ```bash
   bun run generate
   ```

2. Apply migrations to local database:
   ```bash
   bun run migrate-local
   ```

## Plugin Installation

To install the ComfyUI plugin for connecting machines:

1. Navigate to your ComfyUI custom_nodes directory:
   ```bash
   cd custom_nodes
   ```

2. Clone the repository:
   ```bash
   git clone https://github.com/BennyKok/comfyui-deploy.git
   ```

3. Restart your ComfyUI instance if it's running

4. Access the ComfyUI Deploy dashboard (local or at comfydeploy.com)

5. Add your machine through the Machines > Add Machine option 