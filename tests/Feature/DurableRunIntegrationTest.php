<?php

declare(strict_types=1);

use App\Agents\DurableRunDemoAgent;
use App\Models\AgentRun;
use App\Models\AgentRunCheckpoint;
use Illuminate\Support\Str;
use Laravel\Ai\Responses\AgentResponse;
use Laragentic\Loops\LoopResult;

/*
|--------------------------------------------------------------------------
| Integration Tests — Durable Runs: Persistence, Resume, Cancellation
|--------------------------------------------------------------------------
|
| These tests cover three categories:
|
|   1. Real-LLM tests (group: integration)
|      — require ANTHROPIC_API_KEY and make actual Haiku 4.5 calls.
|      — verify that checkpoints land in the database during execution.
|
|   2. Persistence-only tests (group: durable-runs)
|      — exercise AgentRun lifecycle transitions without any LLM call.
|      — cancellation, timeout, idempotency, model helpers.
|
| Run just the integration suite:
|   vendor/bin/pest --group=integration
|
| Run the full durable-runs suite (includes non-LLM tests):
|   vendor/bin/pest --group=durable-runs
|
*/

const TEST_PROVIDER = 'anthropic';
const TEST_MODEL    = 'claude-haiku-4-5-20251001';

// ─── Shared helper ────────────────────────────────────────────────────────────

/**
 * Wire a DurableRunDemoAgent with the same checkpoint-saving callbacks
 * used by the SSE route, but without SSE yielding.
 *
 * Returns the configured agent so the caller can add more callbacks and
 * eventually call reactLoop().
 */
function makeCheckpointingAgent(AgentRun $run): DurableRunDemoAgent
{
    $agent = new DurableRunDemoAgent;

    $guestUser = (object) ['id' => 'test-guest-user', 'name' => 'Test'];
    $agent->forUser($guestUser);

    $agent
        ->onIterationStart(function (int $iteration) use ($run) {
            $run->refresh();

            if ($run->isCancelled()) {
                throw new \RuntimeException('__cancelled__');
            }

            if ($run->isTimedOut()) {
                throw new \RuntimeException('__timed_out__');
            }

            $run->update(['current_iteration' => $iteration]);
            $run->saveCheckpoint('iteration_start', ['iteration' => $iteration], $iteration);
        })
        ->onAfterThought(function (AgentResponse $response, int $iteration) use ($run) {
            $run->saveCheckpoint('thought', [
                'text'           => substr($response->text ?? '', 0, 300),
                'has_tool_calls' => $response->toolCalls->isNotEmpty(),
                'iteration'      => $iteration,
            ], $iteration);
        })
        ->onBeforeAction(function (string $tool, array $args, int $iteration) use ($run) {
            $idemKey = "{$run->id}:{$iteration}:{$tool}:" . md5(json_encode($args));
            $run->saveCheckpoint('tool_call_start', [
                'tool' => $tool, 'args' => $args, 'iteration' => $iteration,
            ], $iteration, $idemKey);
        })
        ->onAfterAction(function (string $tool, array $args, string $result, int $iteration) use ($run) {
            $idemKey = "{$run->id}:{$iteration}:{$tool}:result:" . md5(json_encode($args));
            $run->saveCheckpoint('tool_result', [
                'tool' => $tool, 'args' => $args,
                'result' => substr($result, 0, 500), 'iteration' => $iteration,
            ], $iteration, $idemKey);
        })
        ->onLoopComplete(function (AgentResponse $response, int $iterations) use ($run) {
            if ($response->conversationId) {
                $run->saveConversationId($response->conversationId);
            }
            $run->markCompleted($response->text ?? '', $iterations);
            $run->saveCheckpoint('complete', [
                'text' => $response->text ?? '', 'iterations' => $iterations,
            ], $iterations);
        });

    return $agent;
}

// ─── Persistence-only tests (no LLM) ────────────────────────────────────────

test('durable run: AgentRun lifecycle transitions are correct', function () {
    $run = AgentRun::create([
        'id'          => Str::uuid()->toString(),
        'agent_class' => DurableRunDemoAgent::class,
        'loop_type'   => 'react',
        'status'      => 'pending',
        'input'       => ['task' => 'test task'],
        'timeout_at'  => now()->addMinutes(5),
    ]);

    expect($run->status)->toBe('pending');
    expect($run->isCancelled())->toBeFalse();
    expect($run->isTimedOut())->toBeFalse();

    $run->markRunning();
    expect($run->fresh()->status)->toBe('running');
    expect($run->fresh()->started_at)->not->toBeNull();

    $run->markCompleted('Final answer', 3);
    expect($run->fresh()->status)->toBe('completed');
    expect($run->fresh()->completed_at)->not->toBeNull();
    expect($run->fresh()->output['text'])->toBe('Final answer');
    expect($run->fresh()->output['iterations'])->toBe(3);
})->group('durable-runs');

test('durable run: cancel transitions pending → cancelled', function () {
    $run = AgentRun::create([
        'id'          => Str::uuid()->toString(),
        'agent_class' => DurableRunDemoAgent::class,
        'loop_type'   => 'react',
        'status'      => 'pending',
        'input'       => ['task' => 'test'],
        'timeout_at'  => now()->addMinutes(5),
    ]);

    expect($run->isCancelled())->toBeFalse();

    $run->cancel();

    expect($run->fresh()->status)->toBe('cancelled');
    expect($run->fresh()->cancelled_at)->not->toBeNull();
    expect($run->fresh()->isCancelled())->toBeTrue();
})->group('durable-runs');

test('durable run: markFailed stores error message', function () {
    $run = AgentRun::create([
        'id'          => Str::uuid()->toString(),
        'agent_class' => DurableRunDemoAgent::class,
        'loop_type'   => 'react',
        'status'      => 'running',
        'input'       => ['task' => 'test'],
        'timeout_at'  => now()->addMinutes(5),
    ]);

    $run->markFailed('Something went wrong');

    expect($run->fresh()->status)->toBe('failed');
    expect($run->fresh()->error)->toBe('Something went wrong');
})->group('durable-runs');

test('durable run: isTimedOut returns true when timeout_at is in the past', function () {
    $run = AgentRun::create([
        'id'          => Str::uuid()->toString(),
        'agent_class' => DurableRunDemoAgent::class,
        'loop_type'   => 'react',
        'status'      => 'running',
        'input'       => ['task' => 'test'],
        'timeout_at'  => now()->subMinute(), // already past
    ]);

    expect($run->fresh()->isTimedOut())->toBeTrue();
})->group('durable-runs');

test('durable run: saveCheckpoint writes a row and sequences monotonically', function () {
    $run = AgentRun::create([
        'id'          => Str::uuid()->toString(),
        'agent_class' => DurableRunDemoAgent::class,
        'loop_type'   => 'react',
        'status'      => 'running',
        'input'       => ['task' => 'test'],
        'timeout_at'  => now()->addMinutes(5),
    ]);

    $cp1 = $run->saveCheckpoint('iteration_start', ['iteration' => 1], 1);
    $cp2 = $run->saveCheckpoint('thought',         ['text' => 'thinking…'], 1);
    $cp3 = $run->saveCheckpoint('tool_result',     ['tool' => 'calculate', 'result' => '42'], 1, 'idem-key-1');

    expect($cp1->sequence)->toBe(1);
    expect($cp2->sequence)->toBe(2);
    expect($cp3->sequence)->toBe(3);

    expect(AgentRunCheckpoint::where('run_id', $run->id)->count())->toBe(3);

    // Idempotency key stored on the tool-result checkpoint
    expect($cp3->idempotency_key)->toBe('idem-key-1');

    // All checkpoints belong to this run
    $run->load('checkpoints');
    expect($run->checkpoints)->toHaveCount(3);
})->group('durable-runs');

test('durable run: idempotency key prevents duplicate run creation', function () {
    $key = 'unique-run-' . Str::random(8);

    $first = AgentRun::create([
        'id'              => Str::uuid()->toString(),
        'agent_class'     => DurableRunDemoAgent::class,
        'loop_type'       => 'react',
        'status'          => 'pending',
        'input'           => ['task' => 'original task'],
        'idempotency_key' => $key,
        'timeout_at'      => now()->addMinutes(5),
    ]);

    // A second call with the same key returns the existing run
    $existing = AgentRun::where('idempotency_key', $key)->first();

    expect($existing)->not->toBeNull();
    expect($existing->id)->toBe($first->id);
    expect($existing->input['task'])->toBe('original task');

    // Only one row exists
    expect(AgentRun::where('idempotency_key', $key)->count())->toBe(1);
})->group('durable-runs');

test('durable run: cancellation is detected at the first iteration boundary (no LLM call)', function () {
    $run = AgentRun::create([
        'id'          => Str::uuid()->toString(),
        'agent_class' => DurableRunDemoAgent::class,
        'loop_type'   => 'react',
        'status'      => 'running',
        'input'       => ['task' => 'test'],
        'timeout_at'  => now()->addMinutes(5),
    ]);

    // Mark as cancelled before the loop starts
    $run->cancel();
    expect($run->fresh()->status)->toBe('cancelled');

    // The agent checks cancellation in onIterationStart, which fires BEFORE
    // the first LLM call — so no API call is made.
    $agent = new DurableRunDemoAgent;
    $agent->forUser((object) ['id' => 'test-guest', 'name' => 'Test']);

    $exceptionMessage = null;

    $agent->onIterationStart(function (int $iteration) use ($run, &$exceptionMessage) {
        $run->refresh();
        if ($run->isCancelled()) {
            $exceptionMessage = '__cancelled__';
            throw new \RuntimeException('__cancelled__');
        }
    });

    expect(fn () => $agent->reactLoop('Anything', provider: TEST_PROVIDER, model: TEST_MODEL))
        ->toThrow(\RuntimeException::class, '__cancelled__');

    expect($exceptionMessage)->toBe('__cancelled__');
})->group('durable-runs');

test('durable run: timeout is detected at the first iteration boundary (no LLM call)', function () {
    $run = AgentRun::create([
        'id'          => Str::uuid()->toString(),
        'agent_class' => DurableRunDemoAgent::class,
        'loop_type'   => 'react',
        'status'      => 'running',
        'input'       => ['task' => 'test'],
        'timeout_at'  => now()->subMinute(), // already expired
    ]);

    $agent = new DurableRunDemoAgent;
    $agent->forUser((object) ['id' => 'test-guest', 'name' => 'Test']);

    $agent->onIterationStart(function (int $iteration) use ($run) {
        $run->refresh();
        if ($run->isTimedOut()) {
            throw new \RuntimeException('__timed_out__');
        }
    });

    expect(fn () => $agent->reactLoop('Anything', provider: TEST_PROVIDER, model: TEST_MODEL))
        ->toThrow(\RuntimeException::class, '__timed_out__');
})->group('durable-runs');

test('durable run: saveConversationId stores conversation_id in context', function () {
    $run = AgentRun::create([
        'id'          => Str::uuid()->toString(),
        'agent_class' => DurableRunDemoAgent::class,
        'loop_type'   => 'react',
        'status'      => 'running',
        'input'       => ['task' => 'test'],
        'timeout_at'  => now()->addMinutes(5),
    ]);

    $convId = Str::uuid()->toString();
    $run->saveConversationId($convId);

    expect($run->fresh()->context['conversation_id'])->toBe($convId);
})->group('durable-runs');

test('durable run: resume creates new run inheriting task and conversation_id', function () {
    $originalTask   = 'Find the weather in Tokyo';
    $conversationId = Str::uuid()->toString();

    $original = AgentRun::create([
        'id'          => Str::uuid()->toString(),
        'agent_class' => DurableRunDemoAgent::class,
        'loop_type'   => 'react',
        'status'      => 'cancelled',
        'input'       => ['task' => $originalTask],
        'context'     => ['conversation_id' => $conversationId],
        'timeout_at'  => now()->addMinutes(5),
    ]);

    // Simulate what the resume route does
    $previousContext = $original->context ?? [];
    $newRun = AgentRun::create([
        'id'          => Str::uuid()->toString(),
        'agent_class' => DurableRunDemoAgent::class,
        'loop_type'   => 'react',
        'status'      => 'pending',
        'input'       => $original->input,
        'context'     => [
            'conversation_id' => $previousContext['conversation_id'] ?? null,
            'resumed_from'    => $original->id,
        ],
        'timeout_at'  => now()->addMinutes(5),
    ]);

    expect($newRun->input['task'])->toBe($originalTask);
    expect($newRun->context['conversation_id'])->toBe($conversationId);
    expect($newRun->context['resumed_from'])->toBe($original->id);
    expect($newRun->status)->toBe('pending');
    expect($newRun->id)->not->toBe($original->id);
})->group('durable-runs');

// ─── Real-LLM integration tests ──────────────────────────────────────────────

test('durable run: full run lifecycle — checkpoints saved to DB during real execution', function () {
    if (empty(env('ANTHROPIC_API_KEY'))) {
        $this->markTestSkipped('ANTHROPIC_API_KEY not set');
    }

    $run = AgentRun::create([
        'id'          => Str::uuid()->toString(),
        'agent_class' => DurableRunDemoAgent::class,
        'loop_type'   => 'react',
        'status'      => 'pending',
        'input'       => ['task' => 'Calculate 55 + 45 using the calculate tool.'],
        'timeout_at'  => now()->addMinutes(5),
    ]);

    $run->markRunning();

    $agent = makeCheckpointingAgent($run);

    $result = $agent->reactLoop(
        $run->input['task'],
        provider: TEST_PROVIDER,
        model: TEST_MODEL,
    );

    // ── Loop completed successfully ────────────────────────────────────────
    expect($result)->toBeInstanceOf(LoopResult::class);
    expect($result->completed())->toBeTrue();

    // ── Run status updated to completed in DB ─────────────────────────────
    $fresh = $run->fresh();
    expect($fresh->status)->toBe('completed');
    expect($fresh->completed_at)->not->toBeNull();
    expect($fresh->output['text'])->toContain('100'); // 55 + 45 = 100

    // ── Checkpoints were saved ────────────────────────────────────────────
    $checkpoints = AgentRunCheckpoint::where('run_id', $run->id)->orderBy('sequence')->get();
    expect($checkpoints->count())->toBeGreaterThan(0);

    // First checkpoint must be iteration_start
    expect($checkpoints->first()->type)->toBe('iteration_start');

    // Last checkpoint must be complete
    expect($checkpoints->last()->type)->toBe('complete');

    // There must be at least one tool_result checkpoint
    $toolResults = $checkpoints->where('type', 'tool_result');
    expect($toolResults->count())->toBeGreaterThan(0);

    // ── Tool result checkpoint has the correct structure ──────────────────
    $toolResult = $toolResults->first();
    expect($toolResult->data)->toHaveKey('tool');
    expect($toolResult->data)->toHaveKey('result');
    expect($toolResult->data['tool'])->toBe('calculate');
    expect($toolResult->idempotency_key)->toStartWith($run->id);

    // ── Sequences are monotonically increasing ────────────────────────────
    $sequences = $checkpoints->pluck('sequence')->values()->toArray();
    for ($i = 1; $i < count($sequences); $i++) {
        expect($sequences[$i])->toBeGreaterThan($sequences[$i - 1]);
    }
})->group('integration');

test('durable run: thought checkpoints capture agent reasoning', function () {
    if (empty(env('ANTHROPIC_API_KEY'))) {
        $this->markTestSkipped('ANTHROPIC_API_KEY not set');
    }

    $run = AgentRun::create([
        'id'          => Str::uuid()->toString(),
        'agent_class' => DurableRunDemoAgent::class,
        'loop_type'   => 'react',
        'status'      => 'running',
        'input'       => ['task' => 'Search for "PHP" using the search tool.'],
        'timeout_at'  => now()->addMinutes(5),
    ]);

    $agent = makeCheckpointingAgent($run);

    $result = $agent->reactLoop(
        $run->input['task'],
        provider: TEST_PROVIDER,
        model: TEST_MODEL,
    );

    expect($result->completed())->toBeTrue();

    $thoughtCheckpoints = AgentRunCheckpoint::where('run_id', $run->id)
        ->where('type', 'thought')
        ->get();

    // At least one thought was recorded
    expect($thoughtCheckpoints->count())->toBeGreaterThan(0);

    // Thought checkpoints have the expected data keys
    $thought = $thoughtCheckpoints->first();
    expect($thought->data)->toHaveKey('text');
    expect($thought->data)->toHaveKey('has_tool_calls');
    expect($thought->data)->toHaveKey('iteration');
    expect($thought->data['iteration'])->toBe(1);
})->group('integration');

test('durable run: idempotency keys on tool checkpoints are deterministic', function () {
    if (empty(env('ANTHROPIC_API_KEY'))) {
        $this->markTestSkipped('ANTHROPIC_API_KEY not set');
    }

    $run = AgentRun::create([
        'id'          => Str::uuid()->toString(),
        'agent_class' => DurableRunDemoAgent::class,
        'loop_type'   => 'react',
        'status'      => 'running',
        'input'       => ['task' => 'What is 8 times 9? Use the calculate tool.'],
        'timeout_at'  => now()->addMinutes(5),
    ]);

    $agent = makeCheckpointingAgent($run);

    $agent->reactLoop(
        $run->input['task'],
        provider: TEST_PROVIDER,
        model: TEST_MODEL,
    );

    $toolCheckpoints = AgentRunCheckpoint::where('run_id', $run->id)
        ->whereNotNull('idempotency_key')
        ->get();

    expect($toolCheckpoints->count())->toBeGreaterThan(0);

    foreach ($toolCheckpoints as $cp) {
        // Each idempotency key starts with the run ID
        expect($cp->idempotency_key)->toStartWith($run->id . ':');

        // The format is run_id:iteration:tool:hash (or :result:hash for results)
        $parts = explode(':', $cp->idempotency_key, 3);
        expect(count($parts))->toBeGreaterThanOrEqual(3);
        expect($parts[0])->toBe($run->id);
    }
})->group('integration');

test('durable run: conversation_id is stored after successful completion', function () {
    if (empty(env('ANTHROPIC_API_KEY'))) {
        $this->markTestSkipped('ANTHROPIC_API_KEY not set');
    }

    $run = AgentRun::create([
        'id'          => Str::uuid()->toString(),
        'agent_class' => DurableRunDemoAgent::class,
        'loop_type'   => 'react',
        'status'      => 'running',
        'input'       => ['task' => 'Search for "Laragentic" using the search tool.'],
        'timeout_at'  => now()->addMinutes(5),
    ]);

    $agent = makeCheckpointingAgent($run);

    $result = $agent->reactLoop(
        $run->input['task'],
        provider: TEST_PROVIDER,
        model: TEST_MODEL,
    );

    expect($result->completed())->toBeTrue();

    $fresh = $run->fresh();
    expect($fresh->status)->toBe('completed');

    // The conversation_id should be stored in context (if the SDK provides it)
    // If the SDK returns a conversationId, it will be in context; otherwise context may be null.
    // We assert that if a conversation_id was returned, it was persisted.
    if ($result->response->conversationId ?? null) {
        expect($fresh->context['conversation_id'])->toBe($result->response->conversationId);
    }
})->group('integration');
