<?php

declare(strict_types=1);

namespace App\Agents;

ini_set('time_limit', '300');
ini_set('memory_limit', '512M');
set_time_limit(300);

use App\Tools\CreateProjectTool;
use App\Tools\DeployProjectTool;
use App\Tools\ListProjectsTool;
use App\Tools\SearchTool;
use Laravel\Ai\Concerns\RemembersConversations;
use Laravel\Ai\Contracts\Agent;
use Laravel\Ai\Contracts\Conversational;
use Laravel\Ai\Contracts\HasTools;
use Laravel\Ai\Promptable;
use Laragentic\Loops\ReActLoop;

class McpChatDemoAgent implements Agent, Conversational, HasTools
{
    use Promptable, RemembersConversations, ReActLoop;

    public function instructions(): string
    {
        return <<<'INSTRUCTIONS'
        You are a helpful project management assistant powered by MCP (Model Context Protocol).
        You help users create, configure, and deploy software projects.

        ## Available Capabilities
        - **Create Projects**: Create new projects with various templates (default, api-only, fullstack, microservice)
        - **List Projects**: View all existing projects and their statuses
        - **Deploy Projects**: Deploy projects to cloud environments (staging, production, development)
        - **Search**: Look up information about technologies and best practices

        ## Workflow Guidelines

        ### Project Creation
        - Always ask for a project name before creating
        - Suggest appropriate templates based on the user's description
        - Available templates: default, api-only, fullstack, microservice

        ### Deployment
        - Before deploying, confirm the target environment (staging, production)
        - If cloud credentials are missing, the deploy tool will return an elicitation request
        - When you see an elicitation_required status, explain to the user that they need to provide credentials
        - Tell them a form will appear where they can enter their cloud API key and region
        - After credentials are provided, retry the deployment

        ### Error Handling
        - If a tool returns an error about missing credentials, inform the user clearly
        - Suggest the specific information needed
        - Never fabricate credentials or skip authorization steps

        ## Conversation Style
        - Be conversational and helpful
        - Think step-by-step before taking actions
        - Always use the available tools — don't guess at project data
        - Remember context from previous messages in the conversation
        INSTRUCTIONS;
    }

    public function tools(): iterable
    {
        return [
            new CreateProjectTool,
            new DeployProjectTool,
            new ListProjectsTool,
            new SearchTool,
        ];
    }
}
