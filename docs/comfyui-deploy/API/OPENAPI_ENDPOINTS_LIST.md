# ComfyUI Deploy API Endpoints

Generated from OpenAPI spec at: https://api.comfydeploy.com/internal/openapi.json

## API Information

- **Title**: ComfyDeploy API (Internal)
- **Version**: V2
- **Description**: 
### Overview

Welcome to the ComfyDeploy API!

To create a run thru the API, use the [queue run endpoint](#tag/run/POST/run/deployment/queue).

Check out the [get run endpoint](#tag/run/GET/run/{run_id}), for getting the status and output of a run.

### Authentication

To authenticate your requests, include your API key in the `Authorization` header as a bearer token. Make sure to generate an API key in the [API Keys section of your ComfyDeploy account](https://www.comfydeploy.com/api-keys).

###



## Run

| Method | Endpoint | Summary | Notes |
| ------ | -------- | ------- | ----- |
| GET | /run/{run_id} | Get Run |  |

**Parameters:**

- Path/Query Parameters:
  - `run_id` (Required) [path]: 
  - `queue_position` (Optional) [query]: 

| POST | /run/deployment/queue | Queue Run |  |

**Parameters:**

- Request Body: JSON
  - Schema: DeploymentRunRequest

| POST | /run/deployment/sync | Deployment - Sync |  |

**Parameters:**

- Request Body: JSON
  - Schema: DeploymentRunRequest

| POST | /run/deployment/stream | Deployment - Stream |  |

**Parameters:**

- Request Body: JSON
  - Schema: DeploymentRunRequest

| POST | /run/workflow/queue | Workflow - Queue |  |

**Parameters:**

- Request Body: JSON
  - Schema: WorkflowRunRequest

| POST | /run/workflow/sync | Workflow - Sync |  |

**Parameters:**

- Request Body: JSON
  - Schema: WorkflowRunRequest

| POST | /run/workflow/stream | Workflow - Stream |  |

**Parameters:**

- Request Body: JSON
  - Schema: WorkflowRunRequest

| POST | /run/{run_id}/cancel | Cancel Run |  |

**Parameters:**

- Path/Query Parameters:
  - `run_id` (Required) [path]: 


## Workflow

| Method | Endpoint | Summary | Notes |
| ------ | -------- | ------- | ----- |
| GET | /workflows | Get Workflows |  |

**Parameters:**

- Path/Query Parameters:
  - `search` (Optional) [query]: 
  - `limit` (Optional) [query]: 
  - `offset` (Optional) [query]: 

| GET | /workflows/all | Get All Workflows |  |

**Parameters:**

- Path/Query Parameters:
  - `search` (Optional) [query]: 
  - `limit` (Optional) [query]: 

| PATCH | /workflow/{workflow_id} | Update Workflow |  |

**Parameters:**

- Path/Query Parameters:
  - `workflow_id` (Required) [path]: 
- Request Body: JSON
  - Schema: WorkflowUpdateModel

| DELETE | /workflow/{workflow_id} | Delete Workflow |  |

**Parameters:**

- Path/Query Parameters:
  - `workflow_id` (Required) [path]: 

| GET | /workflow/{workflow_id} | Get Workflow |  |

**Parameters:**

- Path/Query Parameters:
  - `workflow_id` (Required) [path]: 
  - `limit` (Optional) [query]: 

| POST | /workflow/{workflow_id}/clone | Clone Workflow |  |

**Parameters:**

- Path/Query Parameters:
  - `workflow_id` (Required) [path]: 

| GET | /v2/workflow/{workflow_id}/runs | Get All Runs |  |

**Parameters:**

- Path/Query Parameters:
  - `workflow_id` (Required) [path]: 
  - `status` (Optional) [query]: 
  - `deployment_id` (Optional) [query]: 
  - `rf` (Optional) [query]: 
  - `limit` (Optional) [query]: 
  - `offset` (Optional) [query]: 

| GET | /workflow/{workflow_id}/runs/day | Get Runs Day |  |

**Parameters:**

- Path/Query Parameters:
  - `workflow_id` (Required) [path]: 
  - `deployment_id` (Optional) [query]: 

| GET | /workflow/{workflow_id}/runs | Get All Runs V1 |  |

**Parameters:**

- Path/Query Parameters:
  - `workflow_id` (Required) [path]: 
  - `limit` (Optional) [query]: 
  - `offset` (Optional) [query]: 
  - `with_outputs` (Optional) [query]: 
  - `with_inputs` (Optional) [query]: 

| GET | /workflow/{workflow_id}/run/latest | Get Latest Run |  |

**Parameters:**

- Path/Query Parameters:
  - `workflow_id` (Required) [path]: 
  - `limit` (Optional) [query]: 
  - `offset` (Optional) [query]: 

| GET | /workflow/{workflow_id}/versions | Get Versions |  |

**Parameters:**

- Path/Query Parameters:
  - `workflow_id` (Required) [path]: 
  - `search` (Optional) [query]: 
  - `limit` (Optional) [query]: 
  - `offset` (Optional) [query]: 

| GET | /workflow/{workflow_id}/version/{version} | Get Workflow Version |  |

**Parameters:**

- Path/Query Parameters:
  - `workflow_id` (Required) [path]: 
  - `version` (Required) [path]: 

| GET | /workflow-version/{version} | Get Workflow Version By Id |  |

**Parameters:**

- Path/Query Parameters:
  - `version` (Required) [path]: 

| GET | /workflow/{workflow_id}/gallery | Get Workflows Gallery |  |

**Parameters:**

- Path/Query Parameters:
  - `workflow_id` (Required) [path]: 
  - `limit` (Optional) [query]: 
  - `offset` (Optional) [query]: 

| GET | /workflow/{workflow_id}/deployments | Get Deployments |  |

**Parameters:**

- Path/Query Parameters:
  - `workflow_id` (Required) [path]: 

| POST | /workflow | Create Workflow |  |

**Parameters:**

- Request Body: JSON
  - Schema: WorkflowCreateRequest

| POST | /workflow/{workflow_id}/version | Create Workflow Version |  |

**Parameters:**

- Path/Query Parameters:
  - `workflow_id` (Required) [path]: 
- Request Body: JSON
  - Schema: WorkflowVersionCreate

| GET | /workflow/{workflow_id}/export | Get Workflow Export |  |

**Parameters:**

- Path/Query Parameters:
  - `workflow_id` (Required) [path]: 
  - `version` (Optional) [query]: 


## Machine

| Method | Endpoint | Summary | Notes |
| ------ | -------- | ------- | ----- |
| GET | /machine/version | Read Version |  |

**Parameters:**

- Path/Query Parameters:
  - `machine_builder_version` (Optional) [query]: 

| POST | /machine/modal/{app_name}/keep-warm | Set Machine Always On |  |

**Parameters:**

- Path/Query Parameters:
  - `app_name` (Required) [path]: 
- Request Body: JSON
  - Schema: KeepWarmBody

| POST | /machine/modal/cancel-function | Cancel Run |  |

**Parameters:**

- Request Body: JSON
  - Schema: CancelFunctionBody

| POST | /machine/create | Create Machine |  |

**Parameters:**

- Request Body: JSON
  - Schema: BuildMachineItem

| GET | /machines | Get Machines |  |

**Parameters:**

- Path/Query Parameters:
  - `search` (Optional) [query]: 
  - `limit` (Optional) [query]: 
  - `offset` (Optional) [query]: 
  - `is_deleted` (Optional) [query]: 
  - `include_has_workflows` (Optional) [query]: 
  - `is_docker` (Optional) [query]: 
  - `is_workspace` (Optional) [query]: 
  - `is_self_hosted` (Optional) [query]: 
  - `include_docker_command_steps` (Optional) [query]: 

| GET | /machines/all | Get All Machines |  |

**Parameters:**

- Path/Query Parameters:
  - `search` (Optional) [query]: 
  - `limit` (Optional) [query]: 

| GET | /machine/{machine_id} | Get Machine |  |

**Parameters:**

- Path/Query Parameters:
  - `machine_id` (Required) [path]: 

| DELETE | /machine/{machine_id} | Delete Machine |  |

**Parameters:**

- Path/Query Parameters:
  - `machine_id` (Required) [path]: 
  - `force` (Optional) [query]: 

| GET | /machine/{machine_id}/events | Get Machine Events |  |

**Parameters:**

- Path/Query Parameters:
  - `machine_id` (Required) [path]: 

| GET | /machine/{machine_id}/workflows | Get Machine Workflows |  |

**Parameters:**

- Path/Query Parameters:
  - `machine_id` (Required) [path]: 

| POST | /machine/serverless | Create Serverless Machine |  |

**Parameters:**

- Request Body: JSON
  - Schema: ServerlessMachineModel

| POST | /machine/secret | Create Secret |  |

**Parameters:**

- Request Body: JSON
  - Schema: SecretInput

| PATCH | /machine/secret | Update Machine With Secret |  |

**Parameters:**

- Request Body: JSON
  - Schema: UpdateMachineWithSecretInput

| PATCH | /machine/secret/{secret_id}/envs | Update Secret Envs |  |

**Parameters:**

- Path/Query Parameters:
  - `secret_id` (Required) [path]: 
- Request Body: JSON
  - Schema: SecretUpdateInput

| GET | /machine/secrets/all | Get All Secrets |  |
| GET | /machine/{machine_id}/secrets/linked | Get All Linked Machine Secrets |  |

**Parameters:**

- Path/Query Parameters:
  - `machine_id` (Required) [path]: 

| GET | /machine/{machine_id}/secrets/unlinked | Get All Unlinked Machine Secrets |  |

**Parameters:**

- Path/Query Parameters:
  - `machine_id` (Required) [path]: 

| DELETE | /machine/secret/{secret_id} | Delete Secret |  |

**Parameters:**

- Path/Query Parameters:
  - `secret_id` (Required) [path]: 

| PATCH | /machine/serverless/{machine_id} | Update Serverless Machine |  |

**Parameters:**

- Path/Query Parameters:
  - `machine_id` (Required) [path]: 
  - `rollback_version_id` (Optional) [query]: 
- Request Body: JSON
  - Schema: UpdateServerlessMachineModel

| GET | /machine/serverless/{machine_id}/versions | Get Machine Versions |  |

**Parameters:**

- Path/Query Parameters:
  - `machine_id` (Required) [path]: 
  - `limit` (Optional) [query]: 
  - `offset` (Optional) [query]: 

| GET | /machine/serverless/{machine_id}/versions/all | Get All Machine Versions |  |

**Parameters:**

- Path/Query Parameters:
  - `machine_id` (Required) [path]: 

| GET | /machine/serverless/{machine_id}/versions/{version_id} | Get Machine Version |  |

**Parameters:**

- Path/Query Parameters:
  - `machine_id` (Required) [path]: 
  - `version_id` (Required) [path]: 

| GET | /machine/serverless/{machine_id}/files | Get Machine Files |  |

**Parameters:**

- Path/Query Parameters:
  - `machine_id` (Required) [path]: 
  - `path` (Optional) [query]: 

| POST | /machine/serverless/{machine_id}/rollback | Rollback Serverless Machine |  |

**Parameters:**

- Path/Query Parameters:
  - `machine_id` (Required) [path]: 
- Request Body: JSON
  - Schema: RollbackMachineVersionBody

| POST | /machine/custom | Create Custom Machine |  |

**Parameters:**

- Request Body: JSON
  - Schema: CustomMachineModel

| PATCH | /machine/custom/{machine_id} | Update Custom Machine |  |

**Parameters:**

- Path/Query Parameters:
  - `machine_id` (Required) [path]: 
- Request Body: JSON
  - Schema: UpdateCustomMachineModel

| GET | /machine/{machine_id}/docker-commands | Get Machine Docker Commands |  |

**Parameters:**

- Path/Query Parameters:
  - `machine_id` (Required) [path]: 

| GET | /machine/{machine_id}/check-custom-nodes | Check Custom Nodes Version |  |

**Parameters:**

- Path/Query Parameters:
  - `machine_id` (Required) [path]: 

| POST | /machine/{machine_id}/update-custom-nodes | Update Machine Custom Nodes |  |

**Parameters:**

- Path/Query Parameters:
  - `machine_id` (Required) [path]: 


## Log

| Method | Endpoint | Summary | Notes |
| ------ | -------- | ------- | ----- |
| GET | /stream-logs | Stream Logs Endpoint |  |

**Parameters:**

- Path/Query Parameters:
  - `run_id` (Optional) [query]: 
  - `workflow_id` (Optional) [query]: 
  - `session_id` (Optional) [query]: 
  - `machine_id` (Optional) [query]: 
  - `log_level` (Optional) [query]: 

| GET | /stream-progress | Stream Progress Endpoint |  |

**Parameters:**

- Path/Query Parameters:
  - `run_id` (Optional) [query]: 
  - `workflow_id` (Optional) [query]: 
  - `machine_id` (Optional) [query]: 
  - `return_run` (Optional) [query]: 
  - `from_start` (Optional) [query]: 
  - `status` (Optional) [query]: 
  - `deployment_id` (Optional) [query]: 

| GET | /clickhouse-run-logs/{run_id} | Get Clickhouse Run Logs |  |

**Parameters:**

- Path/Query Parameters:
  - `run_id` (Required) [path]: 


## Volumes

| Method | Endpoint | Summary | Notes |
| ------ | -------- | ------- | ----- |
| GET | /volume/private-models | Private Models |  |
| GET | /volume/public-models | Public Models |  |
| GET | /volume/downloading-models | Downloading Models |  |
| POST | /volume/file | Add File Volume |  |

**Parameters:**

- Request Body: JSON
  - Schema: AddFileInputNew

| POST | /file | Add File |  |

**Parameters:**

- Request Body: JSON
  - Schema: AddFileInputNew

| POST | /file/{file_id}/rename | Rename File |  |

**Parameters:**

- Path/Query Parameters:
  - `file_id` (Required) [path]: 
- Request Body: JSON
  - Schema: NewRenameFileBody

| POST | /volume/rm | Remove File |  |

**Parameters:**

- Request Body: JSON
  - Schema: RemovePath

| POST | /volume/validate/huggingface | Validate Huggingface Repo |  |

**Parameters:**

- Request Body: JSON
  - Schema: HuggingFaceValidateRequest

| POST | /volume/validate/civitai | Validate Civitai Url |  |

**Parameters:**

- Request Body: JSON
  - Schema: CivitaiValidateRequest

| POST | /volume/model | Add Model |  |

**Parameters:**

- Request Body: JSON
  - Schema: AddModelRequest

| GET | /volume/name | Get Volume Name Route |  |
| POST | /volume/move | Move File |  |

**Parameters:**

- Request Body: JSON
  - Schema: MoveFileRequest


## Comfy Node

| Method | Endpoint | Summary | Notes |
| ------ | -------- | ------- | ----- |
| GET | /branch-info | Get Branch Info |  |

**Parameters:**

- Path/Query Parameters:
  - `git_url` (Required) [query]: 

| GET | /comfyui-versions | Get Comfyui Versions |  |
| GET | /custom-node-list | Get Nodes Json |  |

## Deployments

| Method | Endpoint | Summary | Notes |
| ------ | -------- | ------- | ----- |
| POST | /deployment | Create Deployment |  |

**Parameters:**

- Request Body: JSON
  - Schema: DeploymentCreate

| PATCH | /deployment/{deployment_id} | Update Deployment |  |

**Parameters:**

- Path/Query Parameters:
  - `deployment_id` (Required) [path]: 
- Request Body: JSON
  - Schema: DeploymentUpdate

| GET | /deployment/{deployment_id} | Get Deployment |  |

**Parameters:**

- Path/Query Parameters:
  - `deployment_id` (Required) [path]: 

| DELETE | /deployment/{deployment_id} | Delete Deployment |  |

**Parameters:**

- Path/Query Parameters:
  - `deployment_id` (Required) [path]: 

| GET | /deployments | Get Deployments |  |

**Parameters:**

- Path/Query Parameters:
  - `environment` (Optional) [query]: 
  - `is_fluid` (Optional) [query]: 

| GET | /share/{username}/{slug} | Get Share Deployment |  |

**Parameters:**

- Path/Query Parameters:
  - `username` (Required) [path]: 
  - `slug` (Required) [path]: 

| GET | /deployments/featured | Get Featured Deployments |  |
| POST | /deployment/{deployment_id}/deactivate | Deactivate Deployment |  |

**Parameters:**

- Path/Query Parameters:
  - `deployment_id` (Required) [path]: 


## Session

| Method | Endpoint | Summary | Notes |
| ------ | -------- | ------- | ----- |
| GET | /session/{session_id} | Get Session |  |

**Parameters:**

- Path/Query Parameters:
  - `session_id` (Required) [path]: 

| DELETE | /session/{session_id} | Delete Session |  |

**Parameters:**

- Path/Query Parameters:
  - `session_id` (Required) [path]: 
  - `wait_for_shutdown` (Optional) [query]: 

| GET | /sessions | Get Machine Sessions |  |

**Parameters:**

- Path/Query Parameters:
  - `machine_id` (Optional) [query]: 

| POST | /session/increase-timeout | Increase Timeout |  |

**Parameters:**

- Request Body: JSON
  - Schema: IncreaseTimeoutBody

| POST | /session/{session_id}/increase-timeout | Increase Timeout 2 |  |

**Parameters:**

- Path/Query Parameters:
  - `session_id` (Required) [path]: 
- Request Body: JSON
  - Schema: IncreaseTimeoutBody2

| POST | /session | Create Session |  |

**Parameters:**

- Request Body: JSON
  - Schema: CreateSessionBody

| POST | /session/{session_id}/snapshot | Snapshot Session |  |

**Parameters:**

- Path/Query Parameters:
  - `session_id` (Required) [path]: 
- Request Body: JSON


## Beta

| Method | Endpoint | Summary | Notes |
| ------ | -------- | ------- | ----- |
| POST | /deps | Convert To Docker Steps |  |

**Parameters:**

- Request Body: JSON
  - Schema: DepsBody

| GET | /session/dynamic/docker-commands | Get Docker Commands From Dynamic Session Body |  |

**Parameters:**

- Request Body: JSON
  - Schema: CreateDynamicSessionBody

| POST | /session/callback | Update Session Callback |  |

**Parameters:**

- Request Body: JSON
  - Schema: UpdateSessionCallbackBody

| POST | /session/callback/log | Update Session Log |  |

**Parameters:**

- Request Body: JSON
  - Schema: UpdateSessionLogBody

| POST | /session/callback/check-timeout | Session Check Timeout |  |

**Parameters:**

- Request Body: JSON
  - Schema: SessionCheckTimeoutBody

| POST | /session/dynamic | Create Dynamic Session |  |

**Parameters:**

- Request Body: JSON
  - Schema: CreateDynamicSessionBody


## Runs

| Method | Endpoint | Summary | Notes |
| ------ | -------- | ------- | ----- |
| GET | /runs | Get Runs |  |

**Parameters:**

- Path/Query Parameters:
  - `limit` (Optional) [query]: 
  - `offset` (Optional) [query]: 
  - `gpu` (Optional) [query]: 
  - `status` (Optional) [query]: 
  - `origin` (Optional) [query]: 
  - `workflow_id` (Optional) [query]: 
  - `duration` (Optional) [query]: 
  - `created_at` (Optional) [query]: 
  - `machine_id` (Optional) [query]: 

| GET | /runs/count | Count Runs |  |

**Parameters:**

- Path/Query Parameters:
  - `start_time` (Optional) [query]: UTC ISO format datetime string (e.g. '2024-03-15T10:00:00Z')
  - `end_time` (Optional) [query]: UTC ISO format datetime string (e.g. '2024-03-15T10:00:00Z')
  - `gpu` (Optional) [query]: GPU type to filter by
  - `status` (Optional) [query]: Run status to filter by (e.g. 'success', 'failed')
  - `origin` (Optional) [query]: Origin of the run to filter by (e.g. 'api', 'manual')
  - `workflow_id` (Optional) [query]: Workflow identifier to filter by
  - `machine_id` (Optional) [query]: Machine identifier to filter by
  - `deployment_id` (Optional) [query]: Deployment identifier to filter by


## File

| Method | Endpoint | Summary | Notes |
| ------ | -------- | ------- | ----- |
| POST | /file/upload | Upload File |  |

**Parameters:**

- Request Body: Available

| POST | /assets/folder | Create Folder |  |

**Parameters:**

- Request Body: JSON
  - Schema: CreateFolderRequest

| GET | /assets | List Assets |  |

**Parameters:**

- Path/Query Parameters:
  - `path` (Optional) [query]: Folder path to list items from

| DELETE | /assets/{asset_id} | Delete Asset |  |

**Parameters:**

- Path/Query Parameters:
  - `asset_id` (Required) [path]: 

| GET | /assets/{asset_id} | Get Asset |  |

**Parameters:**

- Path/Query Parameters:
  - `asset_id` (Required) [path]: 

| POST | /assets/upload | Upload Asset File |  |

**Parameters:**

- Path/Query Parameters:
  - `parent_path` (Optional) [query]: Parent folder path
- Request Body: Available


## Models

| Method | Endpoint | Summary | Notes |
| ------ | -------- | ------- | ----- |
| GET | /models | Public Models |  |

## Platform

| Method | Endpoint | Summary | Notes |
| ------ | -------- | ------- | ----- |
| GET | /platform/user-settings | Get User Settings |  |
| PUT | /platform/user-settings | Update User Settings |  |

**Parameters:**

- Request Body: JSON
  - Schema: UserSettingsUpdateRequest

| GET | /user/{user_id} | Get User Meta |  |

**Parameters:**

- Path/Query Parameters:
  - `user_id` (Required) [path]: 

| GET | /platform/api-keys | Get Api Keys |  |
| POST | /platform/api-keys | Create Api Key |  |
| DELETE | /platform/api-keys/{key_id} | Delete Api Key |  |
| GET | /platform/plan | Get Api Plan |  |
| GET | /platform/upgrade-plan | Get Upgrade Plan |  |

**Parameters:**

- Path/Query Parameters:
  - `plan` (Required) [query]: 
  - `coupon` (Optional) [query]: 

| POST | /platform/stripe/webhook | Stripe Webhook |  |
| GET | /platform/checkout | Stripe Checkout |  |

**Parameters:**

- Path/Query Parameters:
  - `plan` (Required) [query]: 
  - `redirect_url` (Optional) [query]: 
  - `upgrade` (Optional) [query]: 
  - `trial` (Optional) [query]: 
  - `coupon` (Optional) [query]: 

| GET | /platform/gpu-pricing | Gpu Pricing |  |
| GET | /platform/usage-details | Get Usage Details By Day |  |

**Parameters:**

- Path/Query Parameters:
  - `start_time` (Required) [query]: 
  - `end_time` (Required) [query]: 

| GET | /platform/usage | Get Usage |  |

**Parameters:**

- Path/Query Parameters:
  - `start_time` (Optional) [query]: 
  - `end_time` (Optional) [query]: 

| GET | /platform/invoices | Get Monthly Invoices |  |
| GET | /platform/stripe/dashboard | Get Dashboard Url |  |

**Parameters:**

- Path/Query Parameters:
  - `redirect_url` (Optional) [query]: 


## Search

| Method | Endpoint | Summary | Notes |
| ------ | -------- | ------- | ----- |
| GET | /search/model | Search |  |

**Parameters:**

- Path/Query Parameters:
  - `query` (Required) [query]: 
  - `provider` (Optional) [query]: 


## Form

| Method | Endpoint | Summary | Notes |
| ------ | -------- | ------- | ----- |
| GET | /form/onboarding | Check Form Submission |  |
| POST | /form/onboarding | Submit Onboarding Form |  |

**Parameters:**

- Request Body: JSON
  - Schema: OnboardingForm

| PATCH | /form/onboarding | Set Call Booked |  |

**Parameters:**

- Request Body: JSON
  - Schema: FormUpdateRequest


## Admin

| Method | Endpoint | Summary | Notes |
| ------ | -------- | ------- | ----- |
| POST | /admin/deployments/scan-ttl | Scan Deployment Ttl |  |

**Parameters:**

- Path/Query Parameters:
  - `dry_run` (Optional) [query]: 

| POST | /admin/deployments/scan-legacy | Scan Legacy Deployments |  |
| POST | /admin/process-subscriptions | Process Subscriptions Endpoint |  |

**Parameters:**

- Path/Query Parameters:
  - `dry_run` (Optional) [query]: 
  - `send_email` (Optional) [query]: 


