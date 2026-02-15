<?php

use Illuminate\Support\Facades\Route;
use Inertia\Inertia;

Route::get('/', function () {
    return Inertia::render('welcome', [
        'demos' => [
            [
                'title' => 'Tutorial Chat',
                'description' => 'Complete example with conversation context, streaming callbacks, and tool execution',
                'url' => route('tutorial.chat'),
            ],
            [
                'title' => 'ReAct Loop Demo',
                'description' => 'Autonomous agent that reasons, acts, and observes in iterative cycles',
                'url' => route('tutorial.react-loop'),
            ],
            [
                'title' => 'Plan-Execute Demo',
                'description' => 'Multi-step planning agent that breaks down complex tasks and executes them systematically',
                'url' => route('tutorial.plan-execute'),
            ],
            [
                'title' => 'Chain-of-Thought Demo',
                'description' => 'Deep reasoning agent with iterative self-reflection and transparent thinking process',
                'url' => route('tutorial.chain-of-thought'),
            ],
        ],
    ]);
})->name('home');

require __DIR__ . '/tutorial.php';
