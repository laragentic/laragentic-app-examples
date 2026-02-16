<?php

namespace App\Tools;

use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Support\Facades\Cache;
use Laravel\Ai\Contracts\Tool;
use Laravel\Ai\Tools\Request;
use Stringable;

class ConnectRepositoryTool implements Tool
{
    public function name(): string
    {
        return 'connect_repository';
    }

    public function description(): Stringable|string
    {
        return 'Connect a project to a source control provider. Triggers a URL elicitation flow for OAuth authorization when not connected.';
    }

    public function handle(Request $request): Stringable|string
    {
        $projectId = $request['project_id'] ?? '';
        $provider = $request['provider'] ?? 'github';

        if (empty($projectId)) {
            return 'Error: Project ID is required.';
        }

        $stored = Cache::get('mcp_demo_elicitation_connect_repository');

        if (! $stored) {
            $state = substr(md5($projectId . uniqid()), 0, 12);

            return json_encode([
                'status' => 'elicitation_required',
                'type' => 'url',
                'elicitation_id' => 'elicit_' . substr(md5(uniqid()), 0, 12),
                'message' => "Connect {$projectId} to {$provider} by authorizing access.",
                'url' => "https://github.com/login/oauth/authorize?client_id=demo-client&scope=repo,workflow&state={$state}",
            ]);
        }

        return json_encode([
            'status' => 'connected',
            'project_id' => $projectId,
            'provider' => $provider,
            'connected_at' => now()->toIso8601String(),
            'message' => "Repository provider '{$provider}' connected for {$projectId}.",
        ]);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'project_id' => $schema->string()
                ->description('Project ID to connect to source control (e.g., proj_e5f6g7h8)')
                ->required(),
            'provider' => $schema->string()
                ->description('Source control provider to connect. Use github for this demo.'),
        ];
    }
}
