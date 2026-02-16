<?php

declare(strict_types=1);

namespace App\Agents;

ini_set('time_limit', '300');
ini_set('memory_limit', '512M');
set_time_limit(300);

use App\Tools\CalculatorTool;
use App\Tools\SearchTool;
use App\Tools\WeatherTool;
use Laravel\Ai\Concerns\RemembersConversations;
use Laravel\Ai\Contracts\Agent;
use Laravel\Ai\Contracts\Conversational;
use Laravel\Ai\Contracts\HasTools;
use Laravel\Ai\Promptable;
use Laragentic\Loops\ReActLoop;

class TutorialChatAgent implements Agent, Conversational, HasTools
{
    use Promptable, RemembersConversations, ReActLoop;

    public function instructions(): string
    {
        return <<<'INSTRUCTIONS'
        You are a helpful AI assistant with access to several tools.

        When answering questions:
        - Always use the available tools to get accurate information
        - For weather queries, use the get_weather tool
        - For general knowledge or search queries, use the search tool
        - For mathematical calculations, use the calculate tool
        - Provide clear, concise answers based on the tool results
        - Remember context from previous messages in the conversation

        Be conversational and helpful. Don't guess — use the tools!
        INSTRUCTIONS;
    }

    public function tools(): iterable
    {
        return [
            new WeatherTool,
            new SearchTool,
            new CalculatorTool,
        ];
    }
}
