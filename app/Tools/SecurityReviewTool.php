<?php

namespace App\Tools;

use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Support\Facades\Cache;
use Laravel\Ai\Contracts\Tool;
use Laravel\Ai\Tools\Request;
use Stringable;

class SecurityReviewTool implements Tool
{
    public function name(): string
    {
        return 'security_review';
    }

    public function description(): Stringable|string
    {
        return 'Run a pre-release security review for a project. If review inputs are missing, triggers an elicitation form with enums, booleans, email, and numeric fields.';
    }

    public function handle(Request $request): Stringable|string
    {
        $projectId = $request['project_id'] ?? '';

        if (empty($projectId)) {
            return 'Error: Project ID is required.';
        }

        $reviewData = Cache::get('mcp_demo_elicitation_security_review');

        if (! $reviewData) {
            return json_encode([
                'status' => 'elicitation_required',
                'type' => 'form',
                'elicitation_id' => 'elicit_' . substr(md5(uniqid()), 0, 12),
                'message' => "Security review details are required for {$projectId}. Please complete the review form.",
                'requested_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'risk_level' => [
                            'type' => 'string',
                            'title' => 'Risk Level',
                            'description' => 'Overall risk for this release',
                            'enum' => ['low', 'medium', 'high', 'critical'],
                        ],
                        'requires_pen_test' => [
                            'type' => 'boolean',
                            'title' => 'Requires Penetration Test',
                            'description' => 'Whether this release requires an external pen test',
                            'default' => false,
                        ],
                        'security_approver_email' => [
                            'type' => 'string',
                            'title' => 'Security Approver Email',
                            'description' => 'Email for the security approver',
                            'format' => 'email',
                            'minLength' => 5,
                        ],
                        'change_window_hours' => [
                            'type' => 'integer',
                            'title' => 'Change Window (Hours)',
                            'description' => 'Expected maintenance window in hours',
                            'minimum' => 1,
                            'maximum' => 72,
                            'default' => 2,
                        ],
                    ],
                    'required' => ['risk_level', 'security_approver_email'],
                ],
            ]);
        }

        $data = $reviewData['data'] ?? [];
        $riskLevel = $data['risk_level'] ?? 'medium';
        $approver = $data['security_approver_email'] ?? 'unknown';
        $window = $data['change_window_hours'] ?? 2;
        $needsPenTest = ($data['requires_pen_test'] ?? false) ? 'yes' : 'no';

        return json_encode([
            'status' => 'review_completed',
            'project_id' => $projectId,
            'risk_level' => $riskLevel,
            'requires_pen_test' => $needsPenTest,
            'change_window_hours' => $window,
            'security_approver_email' => $approver,
            'message' => "Security review for {$projectId} is complete. Risk: {$riskLevel}, pen test required: {$needsPenTest}, approver: {$approver}.",
        ]);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'project_id' => $schema->string()
                ->description('Project ID to run security review for (e.g., proj_a1b2c3d4)')
                ->required(),
        ];
    }
}
