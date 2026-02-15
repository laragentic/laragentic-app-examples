# Laragentic Examples

**Working Laravel applications demonstrating Laragentic agentic loops in action.**

This repository contains complete, ready-to-run examples of agents using the [Laragentic](https://github.com/laragentic/laragentic) package — a Laravel package that extends the [Laravel AI SDK](https://laravel.com/docs/12.x/ai-sdk) with autonomous agentic loops.

## What's Inside

This is a full Laravel 12 application with Inertia + React demonstrating:

- **ReAct Loop** — Autonomous reasoning + acting agents that call tools iteratively
- **Plan-Execute Loop** — Multi-step planning agents that create plans, execute steps, and synthesize results
- **Streaming Callbacks** — Real-time progress updates via Server-Sent Events (SSE)
- **Multiple Tools** — Calculator, search, and weather tools
- **Production-Ready UI** — Modern React interfaces showing agent progress

## Live Demos

### ReAct Loop Demo

An agent that autonomously reasons, calls tools, and iterates until it reaches an answer.

**Route:** `/react-demo`  
**Agent:** `app/Agents/ReActDemoAgent.php`  
**Frontend:** `resources/js/pages/ReactLoopDemo.tsx`

### Plan-Execute Demo

An agent that creates a plan, executes each step with tools, and synthesizes a final answer.

**Route:** `/plan-execute-demo`  
**Agent:** `app/Agents/PlanExecuteDemoAgent.php`  
**Frontend:** `resources/js/pages/PlanExecuteDemo.tsx`

### Tutorial Chat

A complete conversational agent with streaming tool calls and real-time updates.

**Route:** `/tutorial/chat`  
**Agent:** `app/Agents/TutorialChatAgent.php`  
**Frontend:** `resources/js/pages/TutorialChat.tsx`

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

6. **Build frontend assets:**

```bash
npm run build
```

Or for development with hot reload:

```bash
npm run dev
```

7. **Start the Laravel server:**

```bash
php artisan serve
```

Visit `http://localhost:8000` to see the examples.

## Project Structure

### Agents

All example agents are in `app/Agents/`:

- `ReActDemoAgent.php` — ReAct loop with calculator, search, and weather tools
- `PlanExecuteDemoAgent.php` — Plan-Execute loop with the same tools
- `TutorialChatAgent.php` — Conversational agent from the tutorial

### Tools

Example tools in `app/Tools/`:

- `CalculatorTool.php` — Evaluates mathematical expressions
- `SearchTool.php` — Simulates web search (replace with real API)
- `WeatherTool.php` — Simulates weather lookup (replace with real API)

### Routes

- `routes/web.php` — Main demo routes
- `routes/tutorial.php` — Tutorial-specific routes with streaming SSE endpoints

### Frontend

React components in `resources/js/pages/`:

- `ReactLoopDemo.tsx` — ReAct loop UI with real-time iteration updates
- `PlanExecuteDemo.tsx` — Plan-Execute loop UI showing planning and execution
- `TutorialChat.tsx` — Full chat interface with streaming tool calls

## How It Works

### ReAct Loop Flow

```
User Input → Agent reasons → Calls tools → Observes results → Repeats until done
```

The agent autonomously decides when to use tools and when to produce a final answer.

### Plan-Execute Flow

```
User Task → Agent creates plan → Executes each step → Synthesizes final answer
```

The agent creates a multi-step plan upfront, executes each step (using tools as needed), then combines all results into a coherent answer.

### Streaming Updates

All examples use Server-Sent Events (SSE) to stream progress updates:

- Tool calls (before/after)
- Plan creation
- Step execution
- Final synthesis
- Complete responses

The Laravel routes use `response()->eventStream()` with `reactLoopStream()` or `planExecuteStream()` to propagate progress to the frontend.

## Example Code

### Agent with ReAct Loop

```php
<?php

namespace App\Agents;

use Laravel\Ai\Contracts\Agent;
use Laravel\Ai\Contracts\HasTools;
use Laravel\Ai\Promptable;
use Laragentic\Loops\ReActLoop;

class ReActDemoAgent implements Agent, HasTools
{
    use Promptable, ReActLoop;

    public function instructions(): string
    {
        return 'You are a helpful assistant that can search, calculate, and check weather.';
    }

    public function tools(): iterable
    {
        return [
            new \App\Tools\CalculatorTool,
            new \App\Tools\SearchTool,
            new \App\Tools\WeatherTool,
        ];
    }
}
```

### Streaming Route

```php
Route::get('/react-stream', function () {
    $agent = new \App\Agents\ReActDemoAgent;

    return response()->eventStream(function () use ($agent) {
        $agent
            ->onBeforeAction(function (string $tool, array $args, int $iteration) {
                yield new StreamedEvent('action', ['tool' => $tool, 'status' => 'calling']);
            })
            ->onAfterAction(function (string $tool, array $args, string $result, int $iteration) {
                yield new StreamedEvent('action', ['tool' => $tool, 'result' => $result]);
            })
            ->onLoopComplete(function ($response, int $iterations) {
                yield new StreamedEvent('complete', ['text' => $response->text]);
            });

        yield from $agent->reactLoopStream(request('message'));
    });
});
```

## Learn More

- **[Laragentic Package](https://github.com/laragentic/laragentic)** — Main package documentation, tutorials, and API reference
- **[Laravel AI SDK](https://laravel.com/docs/12.x/ai-sdk)** — Official Laravel AI documentation
- **[Code with PHP](https://codewithphp.com)** — Free learning platform for modern PHP and Laravel

## Contributing

Found a bug or have an improvement? Open an issue or pull request!

## License

MIT License. See [LICENSE](LICENSE) for details.
