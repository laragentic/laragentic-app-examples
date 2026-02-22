<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Immutable, append-only record of a single significant event within a run.
 *
 * Checkpoint types and their data shapes:
 *
 *   iteration_start  – { iteration }
 *   thought          – { text, has_tool_calls, tool_count, iteration }
 *   tool_call_start  – { tool, args, iteration }
 *   tool_result      – { tool, args, result, iteration }
 *   observation      – { text, iteration }
 *   complete         – { text, iterations }
 *   max_iterations   – { iterations, text }
 *
 * The idempotency_key on tool checkpoints is "{run_id}:{iteration}:{tool}:{md5(args)}".
 * Downstream consumers (queue retries, resume logic) can use this key to skip
 * re-executing tool calls that already have a persisted result.
 */
class AgentRunCheckpoint extends Model
{
    protected $primaryKey = 'id';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = [
        'id',
        'run_id',
        'type',
        'sequence',
        'iteration',
        'idempotency_key',
        'data',
        'status',
    ];

    protected $casts = [
        'data' => 'array',
    ];

    // ─── Relationships ───────────────────────────────────────────────────────

    public function run(): BelongsTo
    {
        return $this->belongsTo(AgentRun::class, 'run_id');
    }
}
