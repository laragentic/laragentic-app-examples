<?php

namespace App\Tools;

use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Support\Facades\Cache;
use Laravel\Ai\Contracts\Tool;
use Laravel\Ai\Tools\Request;
use Stringable;

class DeployProjectTool implements Tool
{
    public function name(): string
    {
        return 'deploy_project';
    }

    public function description(): Stringable|string
    {
        return 'Deploy a project to a cloud environment. Requires cloud credentials to be configured. If credentials are missing, an elicitation will be triggered to collect them from the user.';
    }

    public function handle(Request $request): Stringable|string
    {
        $projectId = $request['project_id'] ?? '';
        $environment = $request['environment'] ?? 'staging';

        if (empty($projectId)) {
            return 'Error: Project ID is required.';
        }

        $validEnvironments = ['staging', 'production', 'development'];
        if (! in_array($environment, $validEnvironments)) {
            return "Error: Invalid environment '{$environment}'. Available: " . implode(', ', $validEnvironments);
        }

        // Check if cloud credentials exist (simulating MCP elicitation trigger)
        $credentials = Cache::get('mcp_demo_cloud_credentials', null);

        if (! $credentials) {
            return json_encode([
                'status' => 'elicitation_required',
                'type' => 'form',
                'elicitation_id' => 'elicit_' . substr(md5(uniqid()), 0, 12),
                'message' => 'Cloud deployment credentials are required. Please provide your cloud provider API key and region to proceed with deployment.',
                'requested_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'api_key' => [
                            'type' => 'string',
                            'title' => 'Cloud API Key',
                            'description' => 'Your cloud provider API key for deployment',
                            'minLength' => 10,
                        ],
                        'region' => [
                            'type' => 'string',
                            'title' => 'Deployment Region',
                            'description' => 'The cloud region to deploy to',
                            'enum' => ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'],
                        ],
                        'auto_scale' => [
                            'type' => 'boolean',
                            'title' => 'Enable Auto-Scaling',
                            'description' => 'Automatically scale instances based on traffic',
                            'default' => true,
                        ],
                    ],
                    'required' => ['api_key', 'region'],
                ],
            ]);
        }

        // Simulate successful deployment using the provided credentials
        $deploymentId = 'deploy_' . substr(md5($projectId . time()), 0, 8);
        $region = $credentials['region'] ?? 'us-east-1';
        $autoScale = $credentials['auto_scale'] ?? true;

        return json_encode([
            'status' => 'deployed',
            'deployment' => [
                'id' => $deploymentId,
                'project_id' => $projectId,
                'environment' => $environment,
                'region' => $region,
                'auto_scaling' => $autoScale,
                'url' => "https://{$projectId}.{$environment}.{$region}.example.cloud",
                'deployed_at' => now()->toIso8601String(),
            ],
            'message' => "Project {$projectId} deployed successfully to {$environment} in {$region} (auto-scaling: " . ($autoScale ? 'enabled' : 'disabled') . "). URL: https://{$projectId}.{$environment}.{$region}.example.cloud",
        ]);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'project_id' => $schema->string()
                ->description('The ID of the project to deploy (e.g., proj_abc123)')
                ->required(),
            'environment' => $schema->string()
                ->description('The target environment: staging, production, or development')
                ->required(),
        ];
    }
}
