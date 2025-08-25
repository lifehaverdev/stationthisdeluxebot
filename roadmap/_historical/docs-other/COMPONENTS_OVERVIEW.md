> Imported from docs/comfyui-deploy/COMPONENTS/COMPONENTS_OVERVIEW.md on 2025-08-21

# ComfyUI Deploy Components Overview

ComfyUI Deploy is built as a NextJS application with a well-organized component structure. This document provides an overview of the main components and their responsibilities.

## Core Components

### Backend Services

1. **Authentication** - Implemented using Clerk for user authentication and JWT tokens for API access
2. **Database** - PostgreSQL database with Drizzle ORM for data access and schema management
3. **Storage** - S3/R2 compatible storage for workflow files, machine snapshots, and generated outputs
4. **API Server** - Hono-based API server handling all REST endpoints
5. **Machine Management** - Services for managing ComfyUI machine instances (local, remote, serverless)

### Database Schema

The database schema includes several key entities:

1. **Users** - User accounts managed through Clerk
2. **Workflows** - ComfyUI workflow definitions
3. **Workflow Versions** - Versioned snapshots of workflows
4. **Machines** - ComfyUI instances that can execute workflows
5. **Deployments** - Configurations linking workflows to machines for execution
6. **Workflow Runs** - Execution records of workflows
7. **Workflow Outputs** - Results of workflow executions

### Frontend Components

The frontend is built using NextJS with a variety of React components for the dashboard interface.

## API Routes

API endpoints are implemented in the `/web/src/routes` directory using Hono for routing and request handling. Key route handlers include:

1. **registerCreateRunRoute** - Creates workflow execution runs
2. **registerGetOutputRoute** - Retrieves outputs from workflow runs
3. **registerUploadRoute** - Handles file uploads
4. **registerWorkflowUploadRoute** - Handles workflow definition uploads
5. **registerGetAuthResponse** - Handles authentication responses
6. **registerGetWorkflow** - Retrieves workflow definitions

## Plugins

The ComfyUI plugin component allows any ComfyUI instance to connect to the ComfyUI Deploy platform. The plugin is implemented in the `/web-plugin` directory and can be installed in a ComfyUI instance's `custom_nodes` directory.

## See Also

For more detailed information about specific components, see the following documents:

- [Auth Module](./MODULES_BREAKDOWN/Auth.md)
- [Workflow Module](./MODULES_BREAKDOWN/Workflow.md)
- [Machines Module](./MODULES_BREAKDOWN/Machines.md)
- [Storage Module](./MODULES_BREAKDOWN/Storage.md)
- [Database Module](./MODULES_BREAKDOWN/Database.md) 