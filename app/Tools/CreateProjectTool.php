<?php

namespace App\Tools;

use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Ai\Contracts\Tool;
use Laravel\Ai\Tools\Request;
use Stringable;

class CreateProjectTool implements Tool
{
    public function name(): string
    {
        return 'create_project';
    }

    public function description(): Stringable|string
    {
        return 'Create a new project with the given name and template. Available templates: default, api-only, fullstack, microservice.';
    }

    public function handle(Request $request): Stringable|string
    {
        $name = $request['name'] ?? '';
        $template = $request['template'] ?? 'default';

        if (empty($name)) {
            return 'Error: Project name is required.';
        }

        $validTemplates = ['default', 'api-only', 'fullstack', 'microservice'];
        if (! in_array($template, $validTemplates)) {
            return "Error: Invalid template '{$template}'. Available templates: " . implode(', ', $validTemplates);
        }

        // Mock project creation
        $projectId = 'proj_' . substr(md5($name . time()), 0, 8);

        return json_encode([
            'status' => 'created',
            'project' => [
                'id' => $projectId,
                'name' => $name,
                'template' => $template,
                'status' => 'active',
                'created_at' => now()->toIso8601String(),
            ],
            'message' => "Project '{$name}' created successfully with the '{$template}' template. Project ID: {$projectId}",
        ]);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'name' => $schema->string()
                ->description('The name of the project to create')
                ->required(),
            'template' => $schema->string()
                ->description('The project template to use. Options: default, api-only, fullstack, microservice'),
        ];
    }
}
