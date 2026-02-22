<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

/**
 * Represents a single durable agent execution.
 *
 * Key concepts demonstrated:
 *   - Run IDs      : stable UUID returned to callers before execution begins
 *   - Idempotency  : callers supply a key; duplicate starts return the existing run
 *   - Checkpoints  : see AgentRunCheckpoint – one row per significant event
 *   - Cancellation : status polled at every iteration boundary via isCancelled()
 *   - Timeout      : hard deadline checked at every iteration via isTimedOut()
 *   - Resume       : conversation_id stored in context JSON so a continuation run
 *                    can call RemembersConversations::continue() with the same history
 */
class AgentRun extends Model
{
    protected $primaryKey = 'id';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = [
        'id',
        'agent_class',
        'loop_type',
        'status',
        'input',
        'output',
        'context',
        'current_iteration',
        'idempotency_key',
        'timeout_at',
        'started_at',
        'completed_at',
        'cancelled_at',
        'error',
        'user_id',
    ];

    protected $casts = [
        'input'        => 'array',
        'output'       => 'array',
        'context'      => 'array',
        'timeout_at'   => 'datetime',
        'started_at'   => 'datetime',
        'completed_at' => 'datetime',
        'cancelled_at' => 'datetime',
    ];

    // ─── Relationships ───────────────────────────────────────────────────────

    public function checkpoints(): HasMany
    {
        return $this->hasMany(AgentRunCheckpoint::class, 'run_id')->orderBy('sequence');
    }

    // ─── Status Queries ──────────────────────────────────────────────────────

    public function isCancelled(): bool
    {
        return $this->status === 'cancelled';
    }

    public function isTimedOut(): bool
    {
        return $this->timeout_at !== null && now()->isAfter($this->timeout_at);
    }

    // ─── Lifecycle Transitions ───────────────────────────────────────────────

    public function markRunning(): static
    {
        $this->update(['status' => 'running', 'started_at' => now()]);

        return $this;
    }

    public function markCompleted(string $outputText, int $iterations = 0): static
    {
        $this->update([
            'status'       => 'completed',
            'output'       => ['text' => $outputText, 'iterations' => $iterations],
            'completed_at' => now(),
        ]);

        return $this;
    }

    public function markFailed(string $error): static
    {
        $this->update(['status' => 'failed', 'error' => $error]);

        return $this;
    }

    public function cancel(): static
    {
        $this->update(['status' => 'cancelled', 'cancelled_at' => now()]);

        return $this;
    }

    // ─── Checkpoint Helpers ──────────────────────────────────────────────────

    /**
     * Append an immutable checkpoint for the current event.
     *
     * @param  string       $type           e.g. 'tool_result', 'thought', 'iteration_start'
     * @param  array        $data           type-specific payload
     * @param  int          $iteration      loop iteration number
     * @param  string|null  $idempotencyKey "{run_id}:{iteration}:{tool}:{hash}" for tool calls
     */
    public function saveCheckpoint(
        string $type,
        array $data,
        int $iteration = 0,
        ?string $idempotencyKey = null,
    ): AgentRunCheckpoint {
        $sequence = ($this->checkpoints()->max('sequence') ?? 0) + 1;

        return AgentRunCheckpoint::create([
            'id'              => Str::uuid()->toString(),
            'run_id'          => $this->id,
            'type'            => $type,
            'sequence'        => $sequence,
            'iteration'       => $iteration,
            'idempotency_key' => $idempotencyKey,
            'data'            => $data,
            'status'          => 'completed',
        ]);
    }

    /**
     * Store the conversation_id in context so a resumed run can load history.
     */
    public function saveConversationId(string $conversationId): void
    {
        $this->update([
            'context' => array_merge($this->context ?? [], [
                'conversation_id' => $conversationId,
            ]),
        ]);
    }
}
