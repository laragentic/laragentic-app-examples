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

/**
 * A ReAct agent wired for durable, resumable execution.
 *
 * Implementing Conversational + RemembersConversations means every run
 * automatically persists its full message history (thoughts, tool calls,
 * observations) to the agent_conversation_messages table.
 *
 * The durable run routes store the resulting conversation_id in the
 * agent_runs.context JSON column, so a resumed run can call
 *   $agent->continue($conversationId, $guestUser)
 * and the model receives the full prior history — no tool needs to be
 * re-executed from scratch.
 */
class DurableRunDemoAgent implements Agent, Conversational, HasTools
{
    use Promptable, RemembersConversations, ReActLoop;

    public function instructions(): string
    {
        return <<<'INSTRUCTIONS'
        You are a ReAct (Reasoning + Acting) agent that demonstrates durable, resumable runs.

        For each task:
        1. THINK: Reason about what information you need
        2. ACT: Use one or more tools to gather that information
        3. OBSERVE: Process the tool results
        4. Repeat until you have a complete, well-supported answer

        Available tools:
        - get_weather: Current weather for any city
        - search: General knowledge and research
        - calculate: Mathematical expressions

        Important behaviour:
        - Every tool call is checkpointed to the database before and after execution.
          If this run is interrupted and resumed, the conversation history will already
          contain all prior tool results, so you should continue from where you left off
          rather than repeating completed steps.
        - Be explicit about your reasoning so checkpoints tell a clear story.
        - Use multiple tools when the task requires it.
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
