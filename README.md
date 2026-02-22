# Laragentic Examples

**Working Laravel applications demonstrating Laragentic agentic loops in action.**

This repository contains complete, ready-to-run examples of agents using the [Laragentic](https://github.com/laragentic/agents) package — a Laravel package that extends the [Laravel AI SDK](https://laravel.com/docs/12.x/ai-sdk) with autonomous agentic loops.

## What's Inside

A full Laravel 12 application with Inertia + React demonstrating:

- **ReAct Loop** — Autonomous reasoning + acting agents that call tools iteratively
- **Plan-Execute Loop** — Multi-step planning agents that create plans, execute steps, and synthesize results
- **Chain-of-Thought Loop** — Deep reasoning agents with iterative self-reflection
- **Durable Runs** — Run IDs, database checkpoints, cancellation, idempotency keys, and resume after interruption
- **MCP Chat** — Project management agent with MCP-style elicitation and dynamic forms
- **Streaming Callbacks** — Real-time progress updates via Server-Sent Events (SSE)
- **Multiple Tools** — Calculator, search, and weather tools
- **Production-Ready UI** — Modern React interfaces showing agent progress

## Live Demos

| Demo | Route | Description |
|------|-------|-------------|
| Tutorial Chat | `/tutorial/chat` | Conversational agent with memory and streaming tool calls |
| ReAct Loop | `/tutorial/react-loop` | Reason → Act → Observe cycle in real time |
| Plan-Execute | `/tutorial/plan-execute` | Multi-step planning, execution, and synthesis |
| Chain-of-Thought | `/tutorial/chain-of-thought` | Iterative self-reflection and deep reasoning |
| MCP Chat | `/tutorial/mcp-chat` | Elicitation forms, OAuth flows, and MCP-UI rendering |
| **Durable Runs** | `/tutorial/durable-run` | Run IDs, checkpoints, cancellation, resume |

### Durable Runs Demo

The Durable Runs demo shows how to make agent executions production-grade:

- **Run IDs** — Every execution gets a stable UUID returned before the loop starts.
- **Checkpoints** — Every iteration boundary, tool call, and result is written to `agent_run_checkpoints` in real time. The UI shows each DB write as it happens.
- **Cancellation** — A `POST /tutorial/durable-run-cancel/{runId}` sets a flag in the database; the running loop detects it at the next `onIterationStart` boundary (before any LLM call).
- **Timeout** — A hard deadline (`timeout_at`) is checked at each iteration. Configurable per run.
- **Idempotency keys** — Callers supply an optional key; the server returns the existing run instead of creating a duplicate, making retries safe. Tool-call checkpoints carry a deterministic key `{run_id}:{iteration}:{tool}:{md5(args)}`.
- **Resume** — Completed or interrupted runs store their `conversation_id`. A resumed run calls `$agent->continue($conversationId)`, giving the model its full message history so it can pick up without repeating completed steps.

## Installation

### Requirements

- PHP 8.2+
- Composer
- Node.js & npm
- An Anthropic API key (or other Laravel AI SDK compatible provider)

### Setup

1. **Clone the repository:**

```bash
git clone https://github.com/laragentic/laragentic-app-examples.git
cd laragentic-app-examples
```

2. **Install PHP dependencies:**

```bash
composer install
```

3. **Install JavaScript dependencies:**

```bash
npm install
```

4. **Copy `.env.example` and configure:**

```bash
cp .env.example .env
php artisan key:generate
```

5. **Add your API key to `.env`:**

```env
ANTHROPIC_API_KEY=your-api-key-here
```

6. **Start the development server:**

```bash
composer run dev
```

This single command starts:
- Laravel development server (`php artisan serve`)
- Queue worker
- Log viewer (`php artisan pail`)
- Vite dev server with hot reload
- MCP sidecar (`npm run dev:mcp`) for MCP Apps + MCP-UI mode

Visit `http://localhost:8000` to see the examples.

> **Alternative:** For production builds, run `npm run build` and then `php artisan serve` separately.

## MCP Apps + MCP-UI Mode

The `MCP Chat Demo` has two modes:

- **Legacy (SSE)** — existing Laravel streaming route + custom elicitation UI
- **MCP Apps** — connects to the local sidecar MCP endpoint and renders resources with `UIResourceRenderer` and `AppRenderer`

### Configure GitHub OAuth for sidecar

```env
VITE_MCP_APPS_URL=http://127.0.0.1:3232/mcp
VITE_MCP_OAUTH_AUTHORIZE_URL=http://127.0.0.1:3232/oauth/authorize
VITE_MCP_UI_MODE_DEFAULT=mcp-apps

MCP_APPS_BASE_URL=http://127.0.0.1:3232
MCP_ALLOWED_ORIGINS=http://127.0.0.1:8000,http://localhost:8000
MCP_OAUTH_ENCRYPTION_KEY=change-me-local-dev-only
GITHUB_CLIENT_ID=your-github-oauth-app-client-id
GITHUB_CLIENT_SECRET=your-github-oauth-app-client-secret
```

GitHub OAuth callback URL: `http://127.0.0.1:3232/oauth/callback/github`

## Project Structure

### Agents

All example agents are in `app/Agents/`:

| File | Loop | Notes |
|------|------|-------|
| `ReActDemoAgent.php` | ReAct | Calculator, search, and weather tools |
| `PlanExecuteDemoAgent.php` | Plan-Execute | Multi-step planning with the same tools |
| `ChainOfThoughtDemoAgent.php` | Chain-of-Thought | Iterative reflection and reasoning |
| `TutorialChatAgent.php` | ReAct | Conversational; implements `Conversational` + `RemembersConversations` |
| `McpChatDemoAgent.php` | ReAct | MCP tools with elicitation flows |
| `DurableRunDemoAgent.php` | ReAct | Implements `Conversational` for resume support |

### Tools

Example tools in `app/Tools/`:

- `CalculatorTool.php` — Evaluates mathematical expressions
- `SearchTool.php` — Simulates web search (replace with a real API)
- `WeatherTool.php` — Simulates weather lookup (replace with a real API)
- `CreateProjectTool.php`, `DeployProjectTool.php`, `ListProjectsTool.php` — MCP demo tools
- `SecurityReviewTool.php`, `IncidentEscalationTool.php`, `ConnectRepositoryTool.php` — MCP elicitation tools

### Database

| Table | Purpose |
|-------|---------|
| `agent_conversations` | Conversation metadata (from Laravel AI SDK) |
| `agent_conversation_messages` | Full message history per conversation |
| `agent_runs` | One row per durable run — status, input, output, idempotency key, timeout |
| `agent_run_checkpoints` | Append-only log of every significant event during a run |

### Routes

- `routes/web.php` — Welcome page and route registration
- `routes/tutorial.php` — All tutorial SSE endpoints and API routes

### Frontend

React components in `resources/js/pages/`:

| File | Description |
|------|-------------|
| `ReactLoopDemo.tsx` | ReAct loop UI with real-time iteration and event log |
| `PlanExecuteDemo.tsx` | Plan-Execute UI showing planning, step execution, and synthesis |
| `ChainOfThoughtDemo.tsx` | Chain-of-Thought UI with reasoning and reflection steps |
| `TutorialChat.tsx` | Full chat interface with conversation persistence |
| `McpChatDemo.tsx` | MCP Chat with elicitation forms and OAuth flows |
| `DurableRunDemo.tsx` | Durable runs: run ID display, live checkpoint feed, cancel, resume, past runs |

## How It Works

### ReAct Loop

```
User Input → Think → Use tool → Observe result → Repeat until confident → Answer
```

The agent autonomously decides when to use tools and when to produce a final answer.

### Plan-Execute Loop

```
User Task → Create plan → Execute each step (with tools) → Synthesize final answer
```

The agent creates a multi-step plan upfront, executes each step using tools as needed, then combines all results into a coherent answer. Supports replanning if a step fails.

### Chain-of-Thought Loop

```
Problem → Reason → Reflect → Iterate until confident → Answer
```

The agent explicitly evaluates its own understanding at each step and continues reasoning until it reaches a confident conclusion.

### Durable Runs

```
POST /start → Run ID assigned
GET  /stream?run_id={id} → Agent executes, checkpoints saved per event
POST /cancel/{id}        → Status flag set; loop stops at next iteration
POST /resume/{id}        → New run inherits conversation history; continues
```

Each event in the loop writes an immutable checkpoint row:

```
iteration_start  →  thought  →  tool_call_start  →  tool_result  →  ...  →  complete
```

If a run is interrupted, all checkpoints up to that point are preserved. A resumed run loads the conversation history and continues from where it left off.

### Streaming Updates

All demos use Server-Sent Events (SSE) to push progress to the browser. The Laravel routes use `response()->eventStream()` with `reactLoopStream()`, `planExecuteStream()`, or `chainOfThoughtStream()`.

## Example Code

### Durable Agent with Checkpointing

```php
// 1. Create the run record before execution starts
$run = AgentRun::create([
    'id'              => Str::uuid()->toString(),
    'agent_class'     => DurableRunDemoAgent::class,
    'loop_type'       => 'react',
    'status'          => 'pending',
    'input'           => ['task' => $task],
    'idempotency_key' => $idempotencyKey, // caller-supplied; prevents duplicates on retry
    'timeout_at'      => now()->addMinutes(5),
]);

// 2. Run the agent, saving a checkpoint at each significant event
$agent = new DurableRunDemoAgent;
$agent->forUser($guestUser);

$agent
    ->onIterationStart(function (int $iteration) use ($run) {
        // Cancellation and timeout are checked here, before any LLM call
        $run->refresh();
        if ($run->isCancelled()) throw new RuntimeException('__cancelled__');
        if ($run->isTimedOut())  throw new RuntimeException('__timed_out__');

        $run->saveCheckpoint('iteration_start', ['iteration' => $iteration], $iteration);
    })
    ->onAfterAction(function (string $tool, array $args, string $result, int $iteration) use ($run) {
        // Deterministic idempotency key: same call in same run always produces the same key
        $idemKey = "{$run->id}:{$iteration}:{$tool}:" . md5(json_encode($args));
        $run->saveCheckpoint('tool_result', compact('tool', 'result', 'iteration'), $iteration, $idemKey);
    })
    ->onLoopComplete(function ($response, int $iterations) use ($run) {
        $run->saveConversationId($response->conversationId); // enables resume
        $run->markCompleted($response->text, $iterations);
    });

yield from $agent->reactLoopStream($task);
```

### Resuming an Interrupted Run

```php
// Load the previous run's conversation_id
$previous = AgentRun::find($previousRunId);
$conversationId = $previous->context['conversation_id'] ?? null;

// Create a new run that inherits the conversation history
$newRun = AgentRun::create([
    'id'      => Str::uuid()->toString(),
    'input'   => $previous->input,    // same task
    'context' => ['conversation_id' => $conversationId, 'resumed_from' => $previousRunId],
    // ...
]);

// The agent loads prior messages and picks up where it left off
$agent = new DurableRunDemoAgent;
$agent->continue($conversationId, $guestUser);

yield from $agent->reactLoopStream("Continue the original task: {$previous->input['task']}");
```

### Basic Agent with ReAct Loop

```php
class MyAgent implements Agent, HasTools
{
    use Promptable, ReActLoop;

    public function instructions(): string
    {
        return 'You are a helpful assistant. Use tools to answer accurately.';
    }

    public function tools(): iterable
    {
        return [new CalculatorTool, new SearchTool, new WeatherTool];
    }
}
```

### Streaming Route

```php
Route::get('/stream', function () {
    $agent = new MyAgent;

    return response()->eventStream(function () use ($agent) {
        $agent
            ->onBeforeAction(fn($tool, $args, $iter) => yield new StreamedEvent(
                event: 'action',
                data: ['tool' => $tool, 'stage' => 'start'],
            ))
            ->onAfterAction(fn($tool, $args, $result, $iter) => yield new StreamedEvent(
                event: 'action',
                data: ['tool' => $tool, 'result' => $result, 'stage' => 'complete'],
            ))
            ->onLoopComplete(fn($response, $iters) => yield new StreamedEvent(
                event: 'complete',
                data: ['text' => $response->text],
            ));

        yield from $agent->reactLoopStream(request('message'));
    });
});
```

## Testing

The repository includes integration tests that make real API calls to Claude Haiku 4.5.

```bash
# Run integration tests (real LLM calls — requires ANTHROPIC_API_KEY)
vendor/bin/pest --group=integration

# Run persistence tests (no LLM calls — instant)
vendor/bin/pest --group=durable-runs

# Run the full suite
vendor/bin/pest
```

### What the tests cover

**Agent loop tests** (`tests/Feature/AgentLoopsIntegrationTest.php`):
- ReAct loop: tool invocation, callback lifecycle, multi-tool sequencing, max-iterations boundary
- Plan-Execute loop: plan creation, step execution, synthesis, step count accuracy
- Chain-of-Thought loop: reasoning, tool use, confident answer production

**Durable run tests** (`tests/Feature/DurableRunIntegrationTest.php`):
- Lifecycle transitions: `pending → running → completed / cancelled / failed`
- `saveCheckpoint()` writes rows with monotonically increasing sequences
- Idempotency key lookup returns existing run — no duplicate created
- Cancellation detected at first `onIterationStart` **before any LLM call**
- Timeout detected at first `onIterationStart` **before any LLM call**
- `saveConversationId()` persists to `context` JSON for future resumes
- Resume creates a new run inheriting the original task and conversation
- Full real-LLM runs: checkpoints land in DB with correct types and idempotency keys

## Learn More

- **[Laragentic Package](https://github.com/laragentic/agents)** — Main package documentation, tutorials, and API reference
- **[Laravel AI SDK](https://laravel.com/docs/12.x/ai-sdk)** — Official Laravel AI documentation
- **[Code with PHP](https://codewithphp.com)** — Free learning platform for modern PHP and Laravel

## Contributing

Found a bug or have an improvement? Open an issue or pull request!

## License

MIT License. See [LICENSE](LICENSE) for details.
