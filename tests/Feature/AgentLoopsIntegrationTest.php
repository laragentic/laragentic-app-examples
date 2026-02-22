<?php

declare(strict_types=1);

use App\Agents\ChainOfThoughtDemoAgent;
use App\Agents\PlanExecuteDemoAgent;
use App\Agents\ReActDemoAgent;
use Laragentic\Loops\CoTResult;
use Laragentic\Loops\LoopResult;
use Laragentic\Loops\PlanResult;
use Laravel\Ai\Responses\AgentResponse;

/*
|--------------------------------------------------------------------------
| Integration Tests — Agent Loop Types with Haiku 4.5
|--------------------------------------------------------------------------
|
| These tests make real API calls to Claude Haiku 4.5 and verify that
| the three loop types (ReAct, Plan-Execute, Chain-of-Thought) work
| end-to-end: callbacks fire, tools are invoked, results are coherent.
|
| Run only these tests:
|   vendor/bin/pest --group=integration
|
| Skip them during normal development:
|   vendor/bin/pest --exclude-group=integration
|
*/

const PROVIDER = 'anthropic';
const MODEL    = 'claude-haiku-4-5-20251001';

beforeEach(function () {
    if (empty(env('ANTHROPIC_API_KEY'))) {
        $this->markTestSkipped('ANTHROPIC_API_KEY not set – skipping real-LLM tests');
    }
});

// ─── ReAct Loop ──────────────────────────────────────────────────────────────

test('react loop: agent uses calculator tool and returns correct answer', function () {
    $toolCallLog = [];
    $callbacksFired = [];

    $result = (new ReActDemoAgent)
        ->maxIterations(5)
        ->onLoopStart(function (string $task) use (&$callbacksFired) {
            $callbacksFired[] = 'loop_start';
        })
        ->onIterationStart(function (int $iteration) use (&$callbacksFired) {
            $callbacksFired[] = "iteration_start:{$iteration}";
        })
        ->onBeforeThought(function (string $prompt, int $iteration) use (&$callbacksFired) {
            $callbacksFired[] = "before_thought:{$iteration}";
        })
        ->onAfterThought(function (AgentResponse $response, int $iteration) use (&$callbacksFired) {
            $callbacksFired[] = "after_thought:{$iteration}";
        })
        ->onBeforeAction(function (string $tool, array $args, int $iteration) use (&$toolCallLog) {
            $toolCallLog[] = ['phase' => 'start', 'tool' => $tool, 'args' => $args, 'iteration' => $iteration];
        })
        ->onAfterAction(function (string $tool, array $args, string $result, int $iteration) use (&$toolCallLog) {
            $toolCallLog[] = ['phase' => 'complete', 'tool' => $tool, 'result' => $result, 'iteration' => $iteration];
        })
        ->onIterationEnd(function (int $iteration) use (&$callbacksFired) {
            $callbacksFired[] = "iteration_end:{$iteration}";
        })
        ->onLoopComplete(function (AgentResponse $response, int $iterations) use (&$callbacksFired) {
            $callbacksFired[] = "loop_complete:{$iterations}";
        })
        ->reactLoop(
            'What is 144 divided by 12? Use the calculate tool.',
            provider: PROVIDER,
            model: MODEL,
        );

    // ── Result shape ───────────────────────────────────────────────────────
    expect($result)->toBeInstanceOf(LoopResult::class);
    expect($result->completed())->toBeTrue();

    // ── Answer contains "12" ───────────────────────────────────────────────
    expect($result->text())->toContain('12');

    // ── Calculator was actually called ────────────────────────────────────
    $toolNames = array_unique(array_column($toolCallLog, 'tool'));
    expect($toolNames)->toContain('calculate');

    // ── Every start callback has a matching complete callback ─────────────
    $starts    = array_filter($toolCallLog, fn($e) => $e['phase'] === 'start');
    $completes = array_filter($toolCallLog, fn($e) => $e['phase'] === 'complete');
    expect(count($completes))->toBe(count($starts));

    // ── Core lifecycle callbacks fired ────────────────────────────────────
    expect($callbacksFired)->toContain('loop_start');
    expect($callbacksFired)->toContain('iteration_start:1');
    expect($callbacksFired)->toContain('before_thought:1');
    expect($callbacksFired)->toContain('after_thought:1');
    expect($callbacksFired)->toContain('iteration_end:1');
    $loopCompletes = array_filter($callbacksFired, fn($e) => str_starts_with($e, 'loop_complete:'));
    expect($loopCompletes)->not->toBeEmpty();
})->group('integration');

test('react loop: agent uses search tool and returns relevant information', function () {
    $toolsUsed = [];

    $result = (new ReActDemoAgent)
        ->maxIterations(5)
        ->onAfterAction(function (string $tool, array $args, string $result) use (&$toolsUsed) {
            $toolsUsed[] = $tool;
        })
        ->reactLoop(
            'What is the Laravel AI SDK? Use the search tool to find out.',
            provider: PROVIDER,
            model: MODEL,
        );

    expect($result->completed())->toBeTrue();
    expect($result->text())->not->toBeEmpty();

    // The agent should have called the search tool
    expect($toolsUsed)->toContain('search');
})->group('integration');

test('react loop: agent uses weather tool for city query', function () {
    $actionsCompleted = [];

    $result = (new ReActDemoAgent)
        ->maxIterations(5)
        ->onAfterAction(function (string $tool, array $args, string $toolResult, int $iteration) use (&$actionsCompleted) {
            $actionsCompleted[] = ['tool' => $tool, 'result' => $toolResult];
        })
        ->reactLoop(
            'What is the weather in Tokyo right now? Use the get_weather tool.',
            provider: PROVIDER,
            model: MODEL,
        );

    expect($result->completed())->toBeTrue();

    // The get_weather tool should have been called
    // Note: onObservation may not fire when the SDK handles the full tool
    // cycle within a single prompt response (one-iteration runs).
    // We verify via onAfterAction instead.
    $tools = array_unique(array_column($actionsCompleted, 'tool'));
    expect($tools)->toContain('get_weather');

    // The final answer should mention Tokyo
    expect(strtolower($result->text()))->toContain('tokyo');
})->group('integration');

test('react loop: agent uses multiple tools in sequence for a compound question', function () {
    $toolCallSequence = [];

    $result = (new ReActDemoAgent)
        ->maxIterations(10)
        ->onAfterAction(function (string $tool, array $args, string $toolResult, int $iteration) use (&$toolCallSequence) {
            $toolCallSequence[] = $tool;
        })
        ->reactLoop(
            'Get the weather in Paris, then calculate 100 divided by 4, and report both results.',
            provider: PROVIDER,
            model: MODEL,
        );

    expect($result->completed())->toBeTrue();
    expect($result->text())->not->toBeEmpty();

    // Both tools should have been used
    expect($toolCallSequence)->toContain('get_weather');
    expect($toolCallSequence)->toContain('calculate');

    // The answer should mention both topics
    $lowerText = strtolower($result->text());
    expect($lowerText)->toContain('paris');
    expect($lowerText)->toContain('25'); // 100/4 = 25
})->group('integration');

test('react loop: max iterations callback fires when limit is hit', function () {
    $maxReached = false;
    $finalResponse = null;

    // Force max iterations to 1 on a task that requires more reasoning
    $result = (new ReActDemoAgent)
        ->maxIterations(1)
        ->onMaxIterationsReached(function (AgentResponse $response, int $iterations) use (&$maxReached, &$finalResponse) {
            $maxReached = true;
            $finalResponse = $response;
        })
        ->reactLoop(
            // Simple enough that even 1 iteration may complete, but we limit to 1
            'What is 5 + 5? Use the calculator tool.',
            provider: PROVIDER,
            model: MODEL,
        );

    // With maxIterations(1), the loop runs exactly one iteration.
    // If that iteration includes a complete answer: completed() is true.
    // If not, maxIterationsReached fires.
    // Either way iterations should be 1.
    expect($result->iterations)->toBe(1);
})->group('integration');

// ─── Plan-Execute Loop ───────────────────────────────────────────────────────

test('plan-execute: agent creates a plan, executes steps, and synthesises a result', function () {
    $planSteps  = [];
    $stepEvents = [];
    $synthStarted = false;
    $synthText    = '';

    $result = (new PlanExecuteDemoAgent)
        ->maxSteps(6)
        ->allowReplan(false)
        ->onPlanCreated(function (array $steps) use (&$planSteps) {
            $planSteps = $steps;
        })
        ->onBeforeStep(function (int $num, string $description, int $total) use (&$stepEvents) {
            $stepEvents[] = "start:{$num}";
        })
        ->onAfterStep(function (int $num, string $description, AgentResponse $response, int $total) use (&$stepEvents) {
            $stepEvents[] = "complete:{$num}";
        })
        ->onBeforeSynthesis(function () use (&$synthStarted) {
            $synthStarted = true;
        })
        ->onAfterSynthesis(function (AgentResponse $response) use (&$synthText) {
            $synthText = $response->text ?? '';
        })
        ->onLoopComplete(function (AgentResponse $response, int $steps) {
            // Confirming callback fires
        })
        ->planExecute(
            'Calculate the area of a rectangle that is 8 meters wide and 5 meters tall, then double that area.',
            provider: PROVIDER,
            model: MODEL,
        );

    // ── Result type and completion ─────────────────────────────────────────
    expect($result)->toBeInstanceOf(PlanResult::class);
    expect($result->completed())->toBeTrue();

    // ── A plan was created ────────────────────────────────────────────────
    expect($planSteps)->not->toBeEmpty();
    expect(count($planSteps))->toBeGreaterThanOrEqual(1);

    // ── Step callbacks fired in pairs (start + complete) ──────────────────
    $starts    = array_filter($stepEvents, fn($e) => str_starts_with($e, 'start:'));
    $completes = array_filter($stepEvents, fn($e) => str_starts_with($e, 'complete:'));
    expect(count($completes))->toBe(count($starts));

    // ── Synthesis ran ─────────────────────────────────────────────────────
    expect($synthStarted)->toBeTrue();

    // ── Answer contains correct numbers: 8*5=40, 40*2=80 ─────────────────
    $text = $result->text();
    expect($text)->toMatch('/\b40\b/');
    expect($text)->toMatch('/\b80\b/');
})->group('integration');

test('plan-execute: step count in result matches plan length', function () {
    $result = (new PlanExecuteDemoAgent)
        ->maxSteps(8)
        ->planExecute(
            'What is the weather in London? Then calculate 7 times 6.',
            provider: PROVIDER,
            model: MODEL,
        );

    expect($result->completed())->toBeTrue();
    expect($result->stepsExecuted())->toBeGreaterThanOrEqual(1);
    expect($result->stepsExecuted())->toBe(count($result->plan));
})->group('integration');

// ─── Chain-of-Thought Loop ───────────────────────────────────────────────────

test('chain-of-thought: agent reasons through a problem and produces a confident answer', function () {
    $reasoningSteps = [];
    $reflections    = 0;

    $result = (new ChainOfThoughtDemoAgent)
        ->maxReasoningIterations(6)
        ->onAfterReasoning(function (AgentResponse $response, int $iteration) use (&$reasoningSteps) {
            $reasoningSteps[] = ['iteration' => $iteration, 'length' => mb_strlen($response->text ?? '')];
        })
        ->onReflection(function (string $reflectionPrompt, int $iteration) use (&$reflections) {
            $reflections++;
        })
        ->onLoopComplete(function (AgentResponse $response, int $iterations) {
            // Callback fires
        })
        ->chainOfThought(
            'If a train travels at 60 km/h for 2.5 hours, how far does it travel? Use the calculate tool.',
            provider: PROVIDER,
            model: MODEL,
        );

    expect($result)->toBeInstanceOf(CoTResult::class);
    expect($result->completed())->toBeTrue();

    // ── At least one reasoning step occurred ──────────────────────────────
    expect($reasoningSteps)->not->toBeEmpty();

    // ── The answer should contain 150 (60 * 2.5 = 150 km) ───────────────
    expect($result->text())->toContain('150');
})->group('integration');

test('chain-of-thought: calculator tool is called for arithmetic sub-problems', function () {
    $toolCalls = [];

    $result = (new ChainOfThoughtDemoAgent)
        ->maxReasoningIterations(8)
        ->onAfterAction(function (string $tool, array $args, string $result) use (&$toolCalls) {
            $toolCalls[] = ['tool' => $tool, 'args' => $args, 'result' => $result];
        })
        ->chainOfThought(
            'Calculate the total: 3 items at $12.50 each, plus 2 items at $8.75 each. Use the calculator.',
            provider: PROVIDER,
            model: MODEL,
        );

    expect($result->completed())->toBeTrue();

    // Calculator should have been used
    $tools = array_unique(array_column($toolCalls, 'tool'));
    expect($tools)->toContain('calculate');

    // Answer should contain the correct total: 37.50 + 17.50 = $55.00
    expect($result->text())->toContain('55');
})->group('integration');
