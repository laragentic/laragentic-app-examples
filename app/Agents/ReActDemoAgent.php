<?php

declare(strict_types=1);

namespace App\Agents;

ini_set('time_limit', '300');
ini_set('memory_limit', '512M');
set_time_limit(300);

use App\Tools\CalculatorTool;
use App\Tools\SearchTool;
use App\Tools\WeatherTool;
use Laravel\Ai\Contracts\Agent;
use Laravel\Ai\Contracts\HasTools;
use Laravel\Ai\Promptable;
use Laragentic\Loops\ReActLoop;

class ReActDemoAgent implements Agent, HasTools
{
    use Promptable, ReActLoop;

    public function instructions(): string
    {
        return <<<'INSTRUCTIONS'
        You are a ReAct (Reasoning + Acting) agent demonstrating the thought-action-observation loop.
        
        For each task:
        1. THINK: Reason about what information you need
        2. ACT: Use a tool to gather that information
        3. OBSERVE: Process the tool's result
        4. Repeat until you can provide a complete answer
        
        Available tools:
        - get_weather: For weather information
        - search: For general knowledge
        - calculate: For mathematical calculations
        
        Show clear reasoning in your responses. Use multiple tools if needed to answer the question thoroughly.
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
