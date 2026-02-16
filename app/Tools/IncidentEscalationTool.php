<?php

namespace App\Tools;

use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Support\Facades\Cache;
use Laravel\Ai\Contracts\Tool;
use Laravel\Ai\Tools\Request;
use Stringable;

class IncidentEscalationTool implements Tool
{
    public function name(): string
    {
        return 'incident_escalation';
    }

    public function description(): Stringable|string
    {
        return 'Prepare an incident escalation plan. If escalation details are missing, triggers an elicitation form with severity, pager settings, and contacts.';
    }

    public function handle(Request $request): Stringable|string
    {
        $service = $request['service'] ?? '';

        if (empty($service)) {
            return 'Error: Service name is required.';
        }

        $planData = Cache::get('mcp_demo_elicitation_incident_escalation');

        if (! $planData) {
            return json_encode([
                'status' => 'elicitation_required',
                'type' => 'form',
                'elicitation_id' => 'elicit_' . substr(md5(uniqid()), 0, 12),
                'message' => "Escalation details are required for service '{$service}'.",
                'requested_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'severity' => [
                            'type' => 'string',
                            'title' => 'Incident Severity',
                            'description' => 'Current severity level',
                            'enum' => ['sev-1', 'sev-2', 'sev-3', 'sev-4'],
                        ],
                        'on_call_contact' => [
                            'type' => 'string',
                            'title' => 'On-Call Contact',
                            'description' => 'Email or alias for primary on-call',
                            'minLength' => 3,
                        ],
                        'page_immediately' => [
                            'type' => 'boolean',
                            'title' => 'Page Immediately',
                            'description' => 'Whether to page the on-call engineer immediately',
                            'default' => true,
                        ],
                        'sla_minutes' => [
                            'type' => 'integer',
                            'title' => 'SLA Response (Minutes)',
                            'description' => 'Expected response time in minutes',
                            'minimum' => 5,
                            'maximum' => 240,
                            'default' => 30,
                        ],
                    ],
                    'required' => ['severity', 'on_call_contact'],
                ],
            ]);
        }

        $data = $planData['data'] ?? [];
        $severity = $data['severity'] ?? 'sev-3';
        $contact = $data['on_call_contact'] ?? 'on-call';
        $immediate = ($data['page_immediately'] ?? true) ? 'yes' : 'no';
        $sla = $data['sla_minutes'] ?? 30;

        return json_encode([
            'status' => 'escalation_ready',
            'service' => $service,
            'severity' => $severity,
            'on_call_contact' => $contact,
            'page_immediately' => $immediate,
            'sla_minutes' => $sla,
            'message' => "Escalation plan ready for {$service}. Severity: {$severity}, on-call: {$contact}, page immediately: {$immediate}, SLA: {$sla} minutes.",
        ]);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'service' => $schema->string()
                ->description('Service name for escalation planning (e.g., api-gateway)')
                ->required(),
        ];
    }
}
