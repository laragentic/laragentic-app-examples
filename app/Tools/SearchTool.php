<?php

namespace App\Tools;

use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Ai\Contracts\Tool;
use Laravel\Ai\Tools\Request;
use Stringable;

class SearchTool implements Tool
{
    public function name(): string
    {
        return 'search';
    }

    public function description(): Stringable|string
    {
        return 'Search for factual information on a topic. Returns a summary of search results.';
    }

    public function handle(Request $request): Stringable|string
    {
        $query = $request['query'] ?? '';

        // Mock search results for demo purposes
        $topics = [
            'laravel' => 'Laravel is a PHP web application framework created by Taylor Otwell. The latest version is Laravel 12.x (2026), featuring the AI SDK, improved performance, and modern PHP 8.2+ support.',
            'react' => 'React is a JavaScript library for building user interfaces, maintained by Meta. React 19 (2025) introduced Server Components and improved streaming support.',
            'ai' => 'Artificial Intelligence in 2026: Major advances include Claude Opus 4.6, GPT-5.2, and Gemini 3 Pro. Agentic AI patterns (ReAct, Plan-Execute) are becoming mainstream in production applications.',
            'weather' => 'Weather forecasting uses a combination of satellite data, ground stations, and AI models. Modern forecasts are accurate up to 10 days with AI-enhanced models.',
        ];

        foreach ($topics as $keyword => $result) {
            if (stripos($query, $keyword) !== false) {
                return "Search results for '{$query}': {$result}";
            }
        }

        return "Search results for '{$query}': Found relevant information about this topic. This is a mock search result for demonstration purposes.";
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'query' => $schema->string()
                ->description('The search query to look up information about')
                ->required(),
        ];
    }
}
