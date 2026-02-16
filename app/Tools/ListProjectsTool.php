<?php

namespace App\Tools;

use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Ai\Contracts\Tool;
use Laravel\Ai\Tools\Request;
use Stringable;

class ListProjectsTool implements Tool
{
    public function name(): string
    {
        return 'list_projects';
    }

    public function description(): Stringable|string
    {
        return 'List all projects belonging to the current user. Returns project IDs, names, templates, and statuses.';
    }

    public function handle(Request $request): Stringable|string
    {
        // Mock project list for demo purposes
        return json_encode([
            'projects' => [
                [
                    'id' => 'proj_a1b2c3d4',
                    'name' => 'My API',
                    'template' => 'api-only',
                    'status' => 'active',
                    'environment' => 'production',
                    'url' => 'https://proj_a1b2c3d4.production.example.cloud',
                    'created_at' => '2026-01-15T10:30:00Z',
                ],
                [
                    'id' => 'proj_e5f6g7h8',
                    'name' => 'Frontend App',
                    'template' => 'fullstack',
                    'status' => 'deploying',
                    'environment' => 'staging',
                    'url' => 'https://proj_e5f6g7h8.staging.example.cloud',
                    'created_at' => '2026-02-01T14:20:00Z',
                ],
                [
                    'id' => 'proj_i9j0k1l2',
                    'name' => 'Auth Microservice',
                    'template' => 'microservice',
                    'status' => 'active',
                    'environment' => 'production',
                    'url' => 'https://proj_i9j0k1l2.production.example.cloud',
                    'created_at' => '2026-02-10T09:15:00Z',
                ],
            ],
            'total' => 3,
        ]);
    }

    public function schema(JsonSchema $schema): array
    {
        return [];
    }
}
