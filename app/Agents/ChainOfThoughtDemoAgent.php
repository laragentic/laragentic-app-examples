<?php

declare(strict_types=1);

namespace App\Agents;

use App\Tools\CalculatorTool;
use App\Tools\SearchTool;
use App\Tools\WeatherTool;
use Laravel\Ai\Contracts\Agent;
use Laravel\Ai\Contracts\HasTools;
use Laravel\Ai\Promptable;
use Laragentic\Loops\ChainOfThoughtLoop;

class ChainOfThoughtDemoAgent implements Agent, HasTools
{
    use Promptable, ChainOfThoughtLoop;

    public function instructions(): string
    {
        return <<<'INSTRUCTIONS'
        You are a Chain-of-Thought reasoning agent that thinks deeply about problems through iterative self-reflection.
        
        Your approach:
        1. ANALYZE: Break down the problem and identify what you know vs. what you need
        2. REASON: Think step-by-step through the logic
        3. GATHER: Use tools when you need information or calculations
        4. REFLECT: Evaluate your understanding and confidence
        5. ITERATE: Continue until you're confident in your answer
        
        Available tools:
        - get_weather: For weather information
        - search: For research and general knowledge
        - calculate: For mathematical operations
        
        Be transparent about your reasoning process. Show your thought progression.
        Only provide a final answer when you're genuinely confident in your understanding.
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
