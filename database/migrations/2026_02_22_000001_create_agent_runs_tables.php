<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Creates two tables for durable agent run tracking:
     *
     *   agent_runs            – one row per logical run (UUID, status, input/output, timeout)
     *   agent_run_checkpoints – append-only log of every iteration/tool-call/observation
     *
     * Together these support:
     *   • Run IDs  – every execution gets a stable UUID that clients can reference
     *   • Idempotency keys – prevent duplicate runs when the caller retries
     *   • Checkpoints – replay-safe log of intermediate state
     *   • Cancellation / timeout – status column polled each iteration
     *   • Resume – conversation_id stored in context JSON so a new run can pick up where
     *              the old one left off via RemembersConversations::continue()
     */
    public function up(): void
    {
        Schema::create('agent_runs', function (Blueprint $table) {
            // Stable run identifier returned to callers immediately after creation
            $table->string('id', 36)->primary();

            $table->string('agent_class');
            $table->string('loop_type', 50); // react | plan-execute | chain-of-thought

            // Lifecycle: pending → running → completed | cancelled | failed
            $table->string('status', 20)->default('pending');

            // Serialised input payload: { task, ... }
            $table->text('input');

            // Final answer written on completion: { text, iterations }
            $table->text('output')->nullable();

            // Mutable blob for resume data: { conversation_id, resumed_from, guest_user_id }
            $table->text('context')->nullable();

            $table->unsignedInteger('current_iteration')->default(0);

            // Caller-supplied key – server returns the existing run instead of creating a new one
            $table->string('idempotency_key', 128)->nullable()->unique();

            // Hard deadline checked at every iteration boundary
            $table->timestamp('timeout_at')->nullable();

            $table->timestamp('started_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();

            $table->text('error')->nullable();

            // Optional association with an app user
            $table->string('user_id')->nullable();

            $table->timestamps();

            $table->index(['status', 'created_at']);
            $table->index('user_id');
        });

        Schema::create('agent_run_checkpoints', function (Blueprint $table) {
            $table->string('id', 36)->primary();

            $table->string('run_id', 36);

            // iteration_start | thought | tool_call_start | tool_result | observation | complete | max_iterations
            $table->string('type', 50);

            // Monotonically increasing within the run – enables ordered replay
            $table->unsignedInteger('sequence');

            $table->unsignedInteger('iteration')->default(0);

            // For tool calls: "{run_id}:{iteration}:{tool}:{md5(args)}" – stored for observability;
            // de-duplication is enforced at the application layer, not via a DB UNIQUE constraint,
            // so that retried checkpoints can be stored with a "skipped" status if needed.
            $table->string('idempotency_key', 200)->nullable();

            // Type-specific payload (tool name, args, result, text, etc.)
            $table->text('data');

            // completed | failed | skipped
            $table->string('status', 20)->default('completed');

            $table->timestamps();

            $table->index(['run_id', 'sequence']);

            $table->foreign('run_id')
                ->references('id')
                ->on('agent_runs')
                ->onDelete('cascade');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('agent_run_checkpoints');
        Schema::dropIfExists('agent_runs');
    }
};
