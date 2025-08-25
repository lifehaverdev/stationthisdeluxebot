> Imported from docs/comfyui-deploy/API/SCHEMAS_SUMMARY.md on 2025-08-21

# ComfyUI Deploy API Schema Definitions

## Schemas

### AddFileInputNew

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| url | string |  | Yes |
| filename | unknown |  | Yes |
| folder_path | string |  | Yes |

### AddModelRequest

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| source | string |  | Yes |
| folderPath | string |  | Yes |
| filename | unknown |  | No |
| huggingface | unknown |  | No |
| civitai | unknown |  | No |
| downloadLink | unknown |  | No |

### AssetResponse

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| id | string |  | Yes |
| user_id | unknown |  | No |
| org_id | unknown |  | No |
| name | string |  | Yes |
| is_folder | boolean |  | Yes |
| path | string |  | Yes |
| file_size | unknown |  | No |
| url | unknown |  | No |
| mime_type | unknown |  | No |
| created_at | string |  | Yes |
| updated_at | string |  | Yes |
| deleted | unknown |  | No |

### Body_upload_asset_file_assets_upload_post

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| file | string |  | Yes |

### Body_upload_file_file_upload_post

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| file | string |  | Yes |

### BuildMachineItem

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| machine_id | string |  | Yes |
| name | string |  | Yes |
| auth_token | string |  | Yes |
| snapshot | unknown |  | No |
| models | unknown |  | No |
| callback_url | string |  | Yes |
| cd_callback_url | string |  | Yes |
| gpu_event_callback_url | string |  | Yes |
| model_volume_name | string |  | Yes |
| run_timeout | unknown |  | No |
| idle_timeout | unknown |  | No |
| ws_timeout | unknown |  | No |
| legacy_mode | unknown |  | No |
| install_custom_node_with_gpu | unknown |  | No |
| gpu | api__modal__builder__GPUType |  | No |
| concurrency_limit | unknown |  | No |
| allow_concurrent_inputs | unknown |  | No |
| deps | unknown |  | No |
| docker_commands | unknown |  | No |
| machine_builder_version | unknown |  | No |
| allow_background_volume_commits | unknown |  | No |
| skip_static_assets | unknown |  | No |
| retrieve_static_assets | unknown |  | No |
| base_docker_image | unknown |  | No |
| python_version | unknown |  | No |
| prestart_command | unknown |  | No |
| extra_args | unknown |  | No |
| modal_app_id | unknown |  | No |
| machine_version_id | unknown |  | No |
| machine_hash | unknown |  | No |
| modal_image_id | unknown |  | No |
| is_deployment | unknown |  | No |
| environment | unknown |  | No |
| disable_metadata | unknown |  | No |
| secrets | unknown |  | No |

### CancelFunctionBody

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| run_id | unknown |  | No |
| function_id | string |  | Yes |

### CivitaiModel

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| url | string |  | Yes |

### CivitaiValidateRequest

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| url | string |  | Yes |

### CivitaiValidateResponse

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| exists | boolean |  | Yes |
| title | unknown |  | No |
| preview_url | unknown |  | No |
| filename | unknown |  | No |
| model_id | unknown |  | No |
| version_id | unknown |  | No |

### CreateDynamicSessionBody

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| gpu | MachineGPU | The GPU to use | No |
| machine_id | unknown | The machine id to use | No |
| machine_version_id | unknown | The machine version id to use | No |
| timeout | unknown | The timeout in minutes | No |
| comfyui_hash | unknown | The comfyui hash to use | No |
| dependencies | unknown | The dependencies to use, either as a DepsBody or a list of shorthand strings | No |
| wait_for_server | boolean | Whether to create the session asynchronously | No |
| base_docker_image | unknown | The base docker image to use | No |
| python_version | unknown | The python version to use | No |

### CreateFolderRequest

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| name | string | Folder name | Yes |
| parent_path | unknown | Parent folder path | No |

### CreateRunResponse

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| run_id | string | The ID of the run, use this to get the run status and outputs | Yes |

### CreateSessionBody

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| machine_id | string |  | Yes |
| gpu | unknown | The GPU to use | No |
| timeout | unknown | The timeout in minutes | No |
| wait_for_server | boolean | Whether to create the session asynchronously | No |

### CreateSessionResponse

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| session_id | string |  | Yes |
| url | unknown |  | No |

### CustomMachineModel

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| name | string |  | Yes |
| type | MachineType |  | Yes |
| endpoint | string |  | Yes |
| auth_token | unknown |  | Yes |

### CustomNode

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| pip | unknown |  | No |
| url | string |  | Yes |
| hash | unknown |  | No |
| install_type | string |  | Yes |
| files | unknown |  | No |
| name | unknown |  | No |

### DeleteSessionResponse

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| success | boolean |  | Yes |

### DependencyGraph

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| comfyui | string |  | Yes |
| models | unknown |  | Yes |
| missing_nodes | array |  | Yes |
| custom_nodes | object |  | Yes |
| files | object |  | Yes |

### DeploymentCreate

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| workflow_version_id | string |  | Yes |
| workflow_id | string |  | Yes |
| machine_id | unknown |  | No |
| machine_version_id | unknown |  | No |
| environment | string |  | Yes |
| description | unknown |  | No |

### DeploymentEnvironment

Type: string

### DeploymentFeaturedModel

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| workflow | object |  | Yes |
| description | unknown |  | No |
| share_slug | unknown |  | No |

### DeploymentModel

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| id | string |  | Yes |
| user_id | string |  | Yes |
| org_id | unknown |  | Yes |
| workflow_version_id | string |  | Yes |
| workflow_id | string |  | Yes |
| machine_id | string |  | Yes |
| share_slug | unknown |  | Yes |
| description | unknown |  | Yes |
| share_options | unknown |  | Yes |
| showcase_media | unknown |  | Yes |
| environment | DeploymentEnvironment |  | Yes |
| created_at | string |  | Yes |
| updated_at | string |  | Yes |
| workflow | unknown |  | No |
| version | unknown |  | No |
| machine | unknown |  | No |
| input_types | unknown |  | No |
| output_types | unknown |  | No |
| dub_link | unknown |  | No |
| gpu | unknown |  | No |
| machine_version_id | unknown |  | No |
| modal_image_id | unknown |  | No |
| concurrency_limit | unknown |  | No |
| run_timeout | unknown |  | No |
| idle_timeout | unknown |  | No |
| keep_warm | unknown |  | No |
| activated_at | unknown |  | No |
| modal_app_id | unknown |  | No |

### DeploymentRunRequest

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| inputs | object | The inputs to the workflow | No |
| webhook | string |  | No |
| webhook_intermediate_status | boolean |  | No |
| gpu | string | The GPU to override the machine's default GPU | No |
| flags | unknown | Array of flag strings | No |
| deployment_id | string |  | Yes |

### DeploymentShareModel

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| id | string |  | Yes |
| user_id | string |  | Yes |
| org_id | unknown |  | Yes |
| share_slug | string |  | Yes |
| description | unknown |  | No |
| workflow | object |  | Yes |
| input_types | unknown |  | Yes |
| output_types | unknown |  | Yes |

### DeploymentUpdate

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| workflow_version_id | unknown |  | No |
| machine_id | unknown |  | No |
| machine_version_id | unknown |  | No |
| concurrency_limit | unknown |  | No |
| gpu | unknown |  | No |
| run_timeout | unknown |  | No |
| idle_timeout | unknown |  | No |
| keep_warm | unknown |  | No |

### DepsBody

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| docker_command_steps | unknown |  | Yes |
| dependencies | unknown |  | No |
| snapshot | unknown |  | No |
| comfyui_version | string |  | No |
| extra_docker_commands | unknown |  | No |

### DockerCommand

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| when | string |  | Yes |
| commands | array |  | Yes |

### EventUpdate

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| event | unknown |  | No |
| data | unknown |  | No |

### EventUpdateEvent

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| event | string |  | No |
| data | EventUpdate |  | Yes |

### FileCustomNodes

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| filename | string |  | Yes |
| disabled | boolean |  | Yes |

### FileUploadResponse

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| message | string | A message indicating the result of the file upload | Yes |
| file_id | string | The unique identifier for the uploaded file | Yes |
| file_name | string | The original name of the uploaded file | Yes |
| file_url | string | The URL where the uploaded file can be accessed | Yes |

### FormUpdateRequest

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| call_booked | boolean |  | Yes |

### GPUEventModel

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| id | string |  | Yes |
| user_id | string |  | Yes |
| org_id | unknown |  | Yes |
| machine_id | unknown |  | Yes |
| start_time | unknown |  | Yes |
| end_time | unknown |  | Yes |
| gpu | unknown |  | Yes |
| ws_gpu | unknown |  | Yes |
| gpu_provider | GPUProviderType |  | Yes |
| created_at | string |  | No |
| updated_at | string |  | No |
| session_timeout | unknown |  | No |
| session_id | unknown |  | No |
| modal_function_id | unknown |  | No |
| tunnel_url | unknown |  | No |
| cost_item_title | unknown |  | No |
| cost | unknown |  | No |

### GPUProviderType

Type: string

### GitCustomNodes

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| hash | string |  | Yes |
| disabled | boolean |  | Yes |
| pip | unknown |  | No |

### HTTPValidationError

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| detail | array |  | No |

### HuggingFaceValidateRequest

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| repo_id | string |  | Yes |

### HuggingFaceValidateResponse

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| exists | boolean |  | Yes |

### HuggingfaceModel

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| repoId | string |  | Yes |

### IncreaseTimeoutBody

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| machine_id | string |  | Yes |
| session_id | string |  | Yes |
| timeout | integer |  | Yes |
| gpu | string |  | Yes |

### IncreaseTimeoutBody2

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| minutes | integer |  | Yes |

### InputModel

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| type | string |  | Yes |
| class_type | string |  | Yes |
| input_id | string |  | Yes |
| default_value | unknown |  | No |
| min_value | unknown |  | No |
| max_value | unknown |  | No |
| display_name | string |  | No |
| description | string |  | No |
| enum_options | unknown | Options for enum input type | No |
| step | unknown | Step for number slider input types | No |

### KeepWarmBody

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| warm_pool_size | integer |  | No |
| gpu | unknown |  | No |

### LegacyDeploymentInfo

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| deployment | DeploymentModel |  | Yes |
| last_run_at | unknown |  | No |

### LegacyDeploymentScanResponse

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| inactive_deployments | array |  | Yes |
| total_scanned | integer |  | Yes |

### LogDataContent

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| logs | string |  | Yes |
| timestamp | string | Timestamp in UTC | Yes |

### LogUpdateEvent

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| event | string |  | No |
| data | LogDataContent |  | Yes |

### MachineGPU

Type: string

### MachineModel

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| comfyui_version | unknown |  | No |
| gpu | unknown |  | No |
| docker_command_steps | unknown |  | No |
| allow_concurrent_inputs | integer |  | No |
| concurrency_limit | integer |  | No |
| install_custom_node_with_gpu | boolean |  | No |
| run_timeout | integer |  | No |
| idle_timeout | integer |  | No |
| extra_docker_commands | unknown |  | No |
| machine_builder_version | unknown |  | No |
| base_docker_image | unknown |  | No |
| python_version | unknown |  | No |
| extra_args | unknown |  | No |
| prestart_command | unknown |  | No |
| keep_warm | integer |  | No |
| status | MachineStatus |  | No |
| build_log | unknown |  | Yes |
| id | string |  | Yes |
| user_id | string |  | Yes |
| name | string |  | Yes |
| org_id | unknown |  | Yes |
| endpoint | string |  | Yes |
| created_at | string |  | Yes |
| updated_at | string |  | Yes |
| disabled | boolean |  | No |
| auth_token | unknown |  | Yes |
| type | MachineType |  | No |
| static_assets_status | MachineStatus |  | No |
| machine_version | unknown |  | Yes |
| snapshot | unknown |  | Yes |
| models | unknown |  | Yes |
| ws_gpu | unknown |  | Yes |
| pod_id | unknown |  | Yes |
| legacy_mode | boolean |  | No |
| ws_timeout | integer |  | No |
| build_machine_instance_id | unknown |  | Yes |
| modal_app_id | unknown |  | Yes |
| target_workflow_id | unknown |  | Yes |
| dependencies | unknown |  | Yes |
| deleted | boolean |  | No |
| allow_background_volume_commits | boolean |  | No |
| gpu_workspace | boolean |  | No |
| retrieve_static_assets | boolean |  | No |
| object_info | unknown |  | Yes |
| object_info_str | unknown |  | Yes |
| filename_list_cache | unknown |  | Yes |
| extensions | unknown |  | Yes |
| import_failed_logs | unknown |  | Yes |
| machine_version_id | unknown |  | Yes |
| has_workflows | boolean |  | No |

### MachineStatus

Type: string

### MachineType

Type: string

### MachineWithName

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| id | string |  | Yes |
| name | string |  | Yes |

### MediaItem

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| url | string |  | Yes |
| type | string |  | Yes |
| filename | string |  | Yes |
| is_public | unknown |  | No |
| subfolder | unknown |  | No |
| upload_duration | unknown |  | No |

### ModalVolFile

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| path | string |  | Yes |
| type | integer |  | Yes |
| mtime | integer |  | Yes |
| size | integer |  | Yes |

### Model-Input

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| name | string |  | Yes |
| type | string |  | Yes |
| base | string |  | Yes |
| save_path | string |  | Yes |
| description | string |  | Yes |
| reference | string |  | Yes |
| filename | string |  | Yes |
| url | string |  | Yes |

### Model-Output

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| id | string |  | Yes |
| user_id | string |  | Yes |
| org_id | unknown |  | Yes |
| description | unknown |  | Yes |
| user_volume_id | string |  | Yes |
| model_name | string |  | Yes |
| folder_path | string |  | Yes |
| target_symlink_path | string |  | Yes |
| civitai_id | unknown |  | Yes |
| civitai_version_id | unknown |  | Yes |
| civitai_url | unknown |  | Yes |
| civitai_download_url | unknown |  | Yes |
| civitai_model_response | unknown |  | Yes |
| hf_url | unknown |  | Yes |
| s3_url | unknown |  | Yes |
| download_progress | integer |  | No |
| user_url | unknown |  | Yes |
| filehash_sha256 | unknown |  | Yes |
| is_public | boolean |  | No |
| status | string |  | No |
| upload_machine_id | unknown |  | Yes |
| upload_type | string |  | Yes |
| model_type | string |  | No |
| error_log | unknown |  | Yes |
| deleted | boolean |  | No |
| is_done | boolean |  | No |
| created_at | string |  | Yes |
| updated_at | string |  | Yes |

### ModelInput

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| input_id | string |  | Yes |
| class_type | unknown |  | Yes |
| required | boolean |  | Yes |
| default_value | unknown |  | No |
| min_value | unknown |  | No |
| max_value | unknown |  | No |
| display_name | unknown |  | No |
| description | unknown |  | No |
| enum_values | unknown |  | No |

### ModelOutput

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| class_type | string |  | Yes |
| output_id | string |  | Yes |

### ModelSearchQuery

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| name | string |  | No |
| type | unknown |  | No |
| provider | string |  | No |
| filename | string |  | No |
| save_path | string |  | No |
| size | unknown |  | No |
| download_url | string |  | No |
| reference_url | string |  | No |

### ModelWithMetadata

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| id | string |  | Yes |
| name | string |  | Yes |
| is_comfyui | boolean |  | No |
| preview_image | unknown |  | No |
| inputs | array |  | Yes |
| outputs | array |  | Yes |
| tags | array |  | No |
| fal_id | unknown |  | No |
| cost_per_megapixel | unknown |  | No |

### MoveFileRequest

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| source_path | string |  | Yes |
| destination_path | string |  | Yes |
| overwrite | boolean |  | No |

### NewRenameFileBody

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| filename | string |  | Yes |

### OnboardingForm

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| inputs | object |  | Yes |

### OutputModel

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| class_type | string |  | Yes |
| output_id | string |  | Yes |

### ProcessSubscriptionsResponse

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| status | string |  | Yes |
| processed_subscriptions | array |  | Yes |
| dry_run | boolean |  | Yes |
| emails_sent | boolean |  | Yes |

### RemovePath

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| path | string |  | Yes |

### RollbackMachineVersionBody

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| machine_version_id | unknown |  | No |
| version | unknown |  | No |

### RunCountResponse

Response model for the run count endpoint

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| count | integer | Number of runs matching the criteria | Yes |
| start_time | unknown | ISO formatted start time if provided | No |
| end_time | unknown | ISO formatted end time if provided | No |
| filters | unknown | Applied filters | No |

### RunFilter

Filter model for run counts

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| gpu | unknown | GPU type to filter by | No |
| status | unknown | Run status (e.g. success, failed) | No |
| origin | unknown | Origin of the run (e.g. api, manual) | No |
| workflow_id | unknown | Workflow identifier | No |
| machine_id | unknown | Machine identifier | No |
| deployment_id | unknown | Deployment identifier | No |

### RunStream

Type: unknown

### SearchModelsResponse

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| models | array |  | Yes |

### SecretInput

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| secret | array |  | Yes |
| secret_name | string |  | Yes |
| machine_id | string |  | Yes |

### SecretKeyValue

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| key | string |  | Yes |
| value | string |  | Yes |

### SecretUpdateInput

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| secret | array |  | Yes |

### ServerlessMachineModel

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| name | string |  | Yes |
| comfyui_version | unknown |  | No |
| gpu | MachineGPU |  | Yes |
| docker_command_steps | unknown |  | No |
| allow_concurrent_inputs | integer |  | No |
| concurrency_limit | integer |  | No |
| install_custom_node_with_gpu | boolean |  | No |
| run_timeout | integer |  | No |
| idle_timeout | integer |  | No |
| extra_docker_commands | unknown |  | No |
| machine_builder_version | unknown |  | No |
| base_docker_image | unknown |  | No |
| python_version | unknown |  | No |
| extra_args | unknown |  | No |
| prestart_command | unknown |  | No |
| keep_warm | unknown |  | No |
| wait_for_build | unknown |  | No |
| optimized_runner | unknown |  | No |
| disable_metadata | unknown |  | No |

### SessionCheckTimeoutBody

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| session_id | string |  | Yes |

### SessionResponse

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| id | string | The session ID | Yes |
| session_id | string | The session ID | Yes |
| gpu_event_id | string | The GPU event ID | Yes |
| url | unknown | The tunnel URL for the session | No |
| gpu | string | The GPU type being used | Yes |
| created_at | string | When the session was created | Yes |
| timeout | unknown | Session timeout in minutes | No |
| timeout_end | unknown | When the session will timeout | No |
| machine_id | unknown | Associated machine ID | No |
| machine_version_id | unknown | Associated machine version ID | No |
| status | string | Session status | No |
| user_id | unknown | Associated user ID | No |
| org_id | unknown | Associated organization ID | No |

### Snapshot

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| comfyui | string |  | Yes |
| git_custom_nodes | object |  | Yes |
| file_custom_nodes | array |  | Yes |

### SnapshotSessionBody

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| machine_name | unknown |  | No |

### TTLScanResponse

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| deactivated | array |  | Yes |
| would_deactivate | array |  | Yes |

### UpdateCustomMachineModel

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| name | unknown |  | No |
| type | unknown |  | No |
| endpoint | unknown |  | No |
| auth_token | unknown |  | No |

### UpdateMachineWithSecretInput

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| machine_id | string |  | Yes |
| secret_id | string |  | Yes |

### UpdateServerlessMachineModel

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| name | unknown |  | No |
| comfyui_version | unknown |  | No |
| gpu | unknown |  | No |
| docker_command_steps | unknown |  | No |
| allow_concurrent_inputs | unknown |  | No |
| concurrency_limit | unknown |  | No |
| install_custom_node_with_gpu | unknown |  | No |
| run_timeout | unknown |  | No |
| idle_timeout | unknown |  | No |
| extra_docker_commands | unknown |  | No |
| machine_builder_version | unknown |  | No |
| base_docker_image | unknown |  | No |
| python_version | unknown |  | No |
| extra_args | unknown |  | No |
| prestart_command | unknown |  | No |
| keep_warm | unknown |  | No |
| is_trigger_rebuild | unknown |  | No |
| optimized_runner | unknown |  | No |
| disable_metadata | unknown |  | No |

### UpdateSessionCallbackBody

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| session_id | string |  | Yes |
| sandbox_id | unknown |  | No |
| tunnel_url | string |  | Yes |
| machine_version_id | unknown |  | No |

### UpdateSessionLogBody

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| session_id | string |  | Yes |
| machine_id | unknown |  | Yes |
| log | string |  | Yes |

### UserSettingsUpdateRequest

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| api_version | unknown |  | No |
| custom_output_bucket | unknown |  | No |
| hugging_face_token | unknown |  | No |
| output_visibility | unknown |  | No |
| s3_access_key_id | unknown |  | No |
| s3_secret_access_key | unknown |  | No |
| s3_bucket_name | unknown |  | No |
| s3_region | unknown |  | No |
| spend_limit | unknown |  | No |

### ValidationError

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| loc | array |  | Yes |
| msg | string |  | Yes |
| type | string |  | Yes |

### WorkflowCreateRequest

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| name | string |  | Yes |
| workflow_json | string |  | Yes |
| workflow_api | unknown |  | No |
| machine_id | unknown |  | No |
| machine_version_id | unknown |  | No |
| comfyui_snapshot | unknown |  | No |

### WorkflowModel

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| id | string |  | Yes |
| user_id | string |  | Yes |
| org_id | unknown |  | Yes |
| name | string |  | Yes |
| selected_machine_id | unknown |  | Yes |
| created_at | string |  | Yes |
| updated_at | string |  | Yes |
| pinned | boolean |  | No |
| deleted | boolean |  | No |
| description | unknown |  | No |
| cover_image | unknown |  | No |

### WorkflowRunModel

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| id | string |  | Yes |
| workflow_version_id | unknown |  | Yes |
| workflow_inputs | unknown |  | Yes |
| workflow_id | string |  | Yes |
| workflow_api | unknown |  | Yes |
| machine_id | unknown |  | Yes |
| origin | string |  | Yes |
| status | string |  | Yes |
| ended_at | unknown |  | No |
| created_at | string |  | Yes |
| updated_at | string |  | Yes |
| queued_at | unknown |  | No |
| started_at | unknown |  | No |
| gpu_event_id | unknown |  | Yes |
| gpu | unknown |  | Yes |
| machine_version | unknown |  | Yes |
| machine_type | unknown |  | Yes |
| modal_function_call_id | unknown |  | Yes |
| user_id | unknown |  | Yes |
| org_id | unknown |  | Yes |
| live_status | unknown |  | Yes |
| progress | number |  | No |
| is_realtime | boolean |  | No |
| webhook | unknown |  | Yes |
| webhook_status | unknown |  | Yes |
| webhook_intermediate_status | boolean |  | No |
| outputs | array |  | No |
| number | unknown |  | No |
| duration | unknown |  | No |
| cold_start_duration | unknown |  | No |
| cold_start_duration_total | unknown |  | No |
| run_duration | unknown |  | No |
| queue_position | unknown |  | No |

### WorkflowRunOrigin

Type: string

### WorkflowRunOutputModel

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| id | string |  | Yes |
| output_id | unknown |  | No |
| run_id | string |  | Yes |
| data | object |  | Yes |
| node_meta | unknown |  | Yes |
| created_at | string |  | Yes |
| updated_at | string |  | Yes |
| type | unknown |  | No |
| node_id | unknown |  | No |

### WorkflowRunRequest

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| inputs | object | The inputs to the workflow | No |
| webhook | string |  | No |
| webhook_intermediate_status | boolean |  | No |
| gpu | string | The GPU to override the machine's default GPU | No |
| flags | unknown | Array of flag strings | No |
| workflow_id | string |  | Yes |
| workflow_api_json | object |  | Yes |
| workflow | object |  | No |
| machine_id | string |  | No |

### WorkflowRunStatus

Type: string

### WorkflowRunWebhookBody

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| run_id | string |  | Yes |
| status | WorkflowRunStatus |  | Yes |
| live_status | unknown |  | Yes |
| progress | number |  | No |
| outputs | array |  | No |

### WorkflowRunWebhookResponse

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| status | string |  | Yes |

### WorkflowUpdateModel

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| name | unknown |  | No |
| selected_machine_id | unknown |  | No |
| pinned | unknown |  | No |
| deleted | unknown |  | No |
| description | unknown |  | No |
| cover_image | unknown |  | No |

### WorkflowVersionCreate

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| workflow | object |  | Yes |
| workflow_api | object |  | Yes |
| comment | unknown |  | No |
| machine_id | unknown |  | No |
| machine_version_id | unknown |  | No |
| comfyui_snapshot | unknown |  | No |

### WorkflowVersionModel

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| id | string |  | Yes |
| workflow_id | string |  | Yes |
| workflow | object |  | Yes |
| workflow_api | unknown |  | Yes |
| user_id | unknown |  | Yes |
| comment | unknown |  | Yes |
| version | integer |  | Yes |
| snapshot | unknown |  | Yes |
| dependencies | unknown |  | Yes |
| created_at | string |  | Yes |
| updated_at | string |  | Yes |

### WorkflowWithName

| Property | Type | Description | Required |
| -------- | ---- | ----------- | -------- |
| id | string |  | Yes |
| name | string |  | Yes |

### WorkspaceGPU

Type: string

### api__modal__builder__GPUType

Type: string

### api__routes__deployments__GPUType

Type: string

