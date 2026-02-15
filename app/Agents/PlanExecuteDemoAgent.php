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
use Laragentic\Loops\PlanExecuteLoop;

class PlanExecuteDemoAgent implements Agent, HasTools
{
    use Promptable, PlanExecuteLoop;

    public function instructions(): string
    {
        return <<<'INSTRUCTIONS'
        You are a Plan-Execute agent that breaks complex tasks into steps.
        
        Your workflow:
        1. PLAN: Break the task into clear, sequential steps
        2. EXECUTE: Complete each step using available tools
        3. SYNTHESIZE: Combine results into a comprehensive answer
        
        Available tools:
        - get_weather: For weather information
        - search: For research and knowledge gathering
        - calculate: For mathematical operations
        
        Create detailed plans with 3-6 steps. Execute each step thoroughly.
        If a step fails, you can adapt and replan.
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
