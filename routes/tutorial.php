<?php

use App\Agents\ChainOfThoughtDemoAgent;
use App\Agents\McpChatDemoAgent;
use App\Agents\PlanExecuteDemoAgent;
use App\Agents\ReActDemoAgent;
use App\Agents\TutorialChatAgent;
use Illuminate\Http\StreamedEvent;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;

/*
|--------------------------------------------------------------------------
| Laragentic Tutorial Routes
|--------------------------------------------------------------------------
|
| These routes power the tutorial examples with fully working code that
| developers can copy and use in their own applications.
|
*/

// Frontend pages
Route::prefix('tutorial')->group(function () {
    Route::get('/chat', function () {
        return Inertia::render('TutorialChat');
    })->name('tutorial.chat');

    Route::get('/react-loop', function () {
        return Inertia::render('ReactLoopDemo');
    })->name('tutorial.react-loop');

    Route::get('/plan-execute', function () {
        return Inertia::render('PlanExecuteDemo');
    })->name('tutorial.plan-execute');

    Route::get('/chain-of-thought', function () {
        return Inertia::render('ChainOfThoughtDemo');
    })->name('tutorial.chain-of-thought');

    Route::get('/mcp-chat', function () {
        return Inertia::render('McpChatDemo');
    })->name('tutorial.mcp-chat');
});

// ─── Complete Example: Chat Agent with Conversation ─────────────────────

Route::get('/tutorial/complete-example', function () {
    $agent = new TutorialChatAgent;
    $conversationId = request()->input('conversation_id');

    // Log the incoming request
    \Log::info('Tutorial chat request', [
        'conversation_id' => $conversationId,
        'message' => request()->input('message'),
        'session_id' => request()->session()->getId(),
    ]);

    // Create a guest user object for conversation tracking
    // In a real app, you'd use auth()->user()
    // Using a fixed guest ID since session IDs may not persist across requests
    $guestUser = (object) [
        'id' => 'tutorial-guest-user',
        'name' => 'Guest',
    ];

    if ($conversationId) {
        // Continue existing conversation
        \Log::info('Continuing conversation', ['conversation_id' => $conversationId, 'user_id' => $guestUser->id]);
        $agent->continue($conversationId, $guestUser);
    } else {
        // Start new conversation for this user
        \Log::info('Starting new conversation', ['user_id' => $guestUser->id]);
        $agent->forUser($guestUser);
    }

    \Log::info('Agent conversation state', [
        'has_participant' => $agent->hasConversationParticipant(),
        'current_conversation' => $agent->currentConversation(),
        'participant_id' => $agent->conversationParticipant()?->id,
    ]);

    return response()->eventStream(function () use ($agent) {
        $agent
            ->onBeforeAction(function (string $tool, array $args, int $iteration) {
                yield new StreamedEvent(
                    event: 'action',
                    data: [
                        'tool' => $tool,
                        'args' => $args,
                        'iteration' => $iteration,
                        'stage' => 'start',
                    ],
                );
            })
            ->onAfterAction(function (string $tool, array $args, string $result, int $iteration) {
                yield new StreamedEvent(
                    event: 'action',
                    data: [
                        'tool' => $tool,
                        'result' => $result,
                        'iteration' => $iteration,
                        'stage' => 'complete',
                    ],
                );
            })
            ->onObservation(function (string $observation, int $iteration) {
                yield new StreamedEvent(
                    event: 'observation',
                    data: [
                        'text' => $observation,
                        'iteration' => $iteration,
                    ],
                );
            })
            ->onLoopComplete(function ($response, int $iterations) use ($agent) {
                $conversationId = $response->conversationId ?? 'NO_CONVERSATION_ID';
                
                yield new StreamedEvent(
                    event: 'complete',
                    data: [
                        'text' => $response->text,
                        'iterations' => $iterations,
                        'conversationId' => $conversationId,
                        'debug' => [
                            'hasConversationId' => $response->conversationId !== null,
                            'conversationIdValue' => $conversationId,
                            'participantId' => $agent->conversationParticipant()?->id,
                        ],
                    ],
                );
            });

        yield from $agent->reactLoopStream(request()->input('message', 'Hello!'));
    });
});

// ─── Quick Reference Examples ────────────────────────────────────────────

Route::get('/tutorial/callback-basic', function () {
    $agent = new TutorialChatAgent;

    return response()->eventStream(function () use ($agent) {
        $agent
            ->onBeforeAction(fn($tool) => yield new StreamedEvent(
                event: 'action',
                data: ['tool' => $tool, 'stage' => 'start']
            ))
            ->onAfterAction(fn($tool, $args, $result) => yield new StreamedEvent(
                event: 'action',
                data: ['tool' => $tool, 'result' => $result, 'stage' => 'complete']
            ))
            ->onLoopComplete(fn($response) => yield new StreamedEvent(
                event: 'complete',
                data: ['text' => $response->text]
            ));

        yield from $agent->reactLoopStream(request('message', 'What is the weather in Tokyo?'));
    });
});

Route::get('/tutorial/callback-streaming', function () {
    $agent = new TutorialChatAgent;

    return response()->eventStream(function () use ($agent) {
        // Stream thinking process
        $agent->onBeforeThought(function (string $prompt, int $iteration) {
            yield new StreamedEvent(
                event: 'thinking',
                data: ['iteration' => $iteration, 'stage' => 'start'],
            );
        });

        // Stream thought results
        $agent->onAfterThought(function ($response, int $iteration) {
            yield new StreamedEvent(
                event: 'thought',
                data: [
                    'iteration' => $iteration,
                    'hasToolCalls' => $response->toolCalls->isNotEmpty(),
                ],
            );
        });

        // Stream final result
        $agent->onLoopComplete(function ($response, int $iterations) {
            yield new StreamedEvent(
                event: 'complete',
                data: ['text' => $response->text, 'iterations' => $iterations],
            );
        });

        yield from $agent->reactLoopStream(request('message', 'Calculate 15 * 23'));
    });
});

Route::get('/tutorial/multi-tool', function () {
    $agent = new TutorialChatAgent;

    return response()->eventStream(function () use ($agent) {
        $toolsUsed = [];

        $agent
            ->onAfterAction(function (string $tool, array $args, string $result) use (&$toolsUsed) {
                $toolsUsed[] = $tool;
                yield new StreamedEvent(
                    event: 'action',
                    data: ['tool' => $tool, 'result' => $result, 'totalTools' => count($toolsUsed)],
                );
            })
            ->onLoopComplete(function ($response) use (&$toolsUsed) {
                yield new StreamedEvent(
                    event: 'complete',
                    data: [
                        'text' => $response->text,
                        'toolsUsed' => $toolsUsed,
                        'toolCount' => count($toolsUsed),
                    ],
                );
            });

        yield from $agent->reactLoopStream(
            request('message', 'What is the weather in Paris? Also calculate 10 + 20.')
        );
    });
});

Route::get('/tutorial/conversation-context', function () {
    $agent = new TutorialChatAgent;
    $conversationId = request('conversation_id');

    if ($conversationId) {
        $agent->withConversation($conversationId);
    }

    return response()->eventStream(function () use ($agent) {
        $agent->onLoopComplete(function ($response, int $iterations) {
            yield new StreamedEvent(
                event: 'complete',
                data: [
                    'text' => $response->text,
                    'conversationId' => $response->conversationId,
                    'iterations' => $iterations,
                ],
            );
        });

        yield from $agent->reactLoopStream(request('message', 'Hello!'));
    });
});

// ─── ReAct Loop Detailed Examples ───────────────────────────────────────

Route::get('/tutorial/react-loop-basic', function () {
    $agent = new ReActDemoAgent;

    return response()->eventStream(function () use ($agent) {
        $agent
            ->onBeforeThought(function (string $prompt, int $iteration) {
                yield new StreamedEvent(
                    event: 'thinking',
                    data: ['iteration' => $iteration],
                );
            })
            ->onAfterAction(function (string $tool, array $args, string $result, int $iteration) {
                yield new StreamedEvent(
                    event: 'action',
                    data: [
                        'tool' => $tool,
                        'result' => $result,
                        'iteration' => $iteration,
                    ],
                );
            })
            ->onObservation(function (string $observation, int $iteration) {
                yield new StreamedEvent(
                    event: 'observation',
                    data: ['text' => $observation, 'iteration' => $iteration],
                );
            })
            ->onLoopComplete(function ($response, int $iterations) {
                yield new StreamedEvent(
                    event: 'complete',
                    data: ['text' => $response->text, 'iterations' => $iterations],
                );
            });

        yield from $agent->reactLoopStream(request('message', 'What is 25 * 4?'));
    });
});

Route::get('/tutorial/react-loop-detailed', function () {
    $agent = new ReActDemoAgent;

    return response()->eventStream(function () use ($agent) {
        try {
            $agent
                ->maxIterations(10)
                ->onIterationStart(function (int $iteration) {
                    yield new StreamedEvent(
                        event: 'iteration',
                        data: ['number' => $iteration, 'status' => 'started'],
                    );
                })
                ->onBeforeThought(function (string $prompt, int $iteration) {
                    yield new StreamedEvent(
                        event: 'thinking',
                        data: ['iteration' => $iteration, 'prompt' => substr($prompt, 0, 100)],
                    );
                })
                ->onAfterThought(function ($response, int $iteration) {
                    yield new StreamedEvent(
                        event: 'thought',
                        data: [
                            'iteration' => $iteration,
                            'text' => $response->text,
                            'hasToolCalls' => $response->toolCalls->isNotEmpty(),
                            'toolCount' => $response->toolCalls->count(),
                        ],
                    );
                })
                ->onBeforeAction(function (string $tool, array $args, int $iteration) {
                    yield new StreamedEvent(
                        event: 'action',
                        data: [
                            'tool' => $tool,
                            'args' => $args,
                            'iteration' => $iteration,
                            'stage' => 'start',
                        ],
                    );
                })
                ->onAfterAction(function (string $tool, array $args, string $result, int $iteration) {
                    yield new StreamedEvent(
                        event: 'action',
                        data: [
                            'tool' => $tool,
                            'result' => $result,
                            'iteration' => $iteration,
                            'stage' => 'complete',
                        ],
                    );
                })
                ->onObservation(function (string $observation, int $iteration) {
                    yield new StreamedEvent(
                        event: 'observation',
                        data: ['text' => $observation, 'iteration' => $iteration],
                    );
                })
                ->onIterationEnd(function (int $iteration) {
                    yield new StreamedEvent(
                        event: 'iteration',
                        data: ['number' => $iteration, 'status' => 'completed'],
                    );
                })
                ->onLoopComplete(function ($response, int $iterations) {
                    yield new StreamedEvent(
                        event: 'complete',
                        data: [
                            'text' => $response->text,
                            'iterations' => $iterations,
                            'conversationId' => $response->conversationId ?? null,
                        ],
                    );
                })
                ->onMaxIterationsReached(function ($response, int $iterations) {
                    yield new StreamedEvent(
                        event: 'max_iterations',
                        data: [
                            'iterations' => $iterations,
                            'text' => $response?->text ?? 'Max iterations reached',
                        ],
                    );
                });

            yield from $agent->reactLoopStream(
                request('message', 'Search for Laravel AI SDK and calculate 42 * 7')
            );
        } catch (\Throwable $e) {
            logger()->error('ReAct loop error', [
                'message' => $e->getMessage(),
                'file' => $e->getFile(),
                'line' => $e->getLine(),
            ]);

            yield new StreamedEvent(
                event: 'error',
                data: [
                    'message' => $e->getMessage(),
                    'type' => get_class($e),
                ],
            );
        }
    });
});

// ─── Plan-Execute Loop Examples ──────────────────────────────────────────

Route::get('/tutorial/plan-execute-basic', function () {
    $agent = new PlanExecuteDemoAgent;

    return response()->eventStream(function () use ($agent) {
        $agent
            ->allowReplan()
            ->maxSteps(8)
            ->onPlanCreated(function (array $steps) {
                yield new StreamedEvent(
                    event: 'plan',
                    data: ['steps' => $steps, 'count' => count($steps)],
                );
            })
            ->onBeforeStep(function (int $stepNumber, string $description, int $totalSteps) {
                yield new StreamedEvent(
                    event: 'step',
                    data: [
                        'stage' => 'start',
                        'number' => $stepNumber,
                        'description' => $description,
                        'total' => $totalSteps,
                    ],
                );
            })
            ->onAfterStep(function (int $stepNumber, string $description, $response, int $totalSteps) {
                yield new StreamedEvent(
                    event: 'step',
                    data: [
                        'stage' => 'complete',
                        'number' => $stepNumber,
                        'description' => $description,
                        'total' => $totalSteps,
                    ],
                );
            })
            ->onBeforeSynthesis(function (array $stepResults) {
                yield new StreamedEvent(
                    event: 'synthesis',
                    data: ['stage' => 'start', 'stepCount' => count($stepResults)],
                );
            })
            ->onAfterSynthesis(function ($response) {
                yield new StreamedEvent(
                    event: 'synthesis',
                    data: ['stage' => 'complete', 'text' => $response->text],
                );
            })
            ->onLoopComplete(function ($response, int $totalSteps) {
                yield new StreamedEvent(
                    event: 'complete',
                    data: [
                        'text' => $response->text ?? 'Synthesis complete',
                        'stepsExecuted' => $totalSteps,
                        'conversationId' => $response->conversationId ?? null,
                    ],
                );
            });

        yield from $agent->planExecuteStream(
            request('task', 'Research AI models and calculate the average temperature of Tokyo, London, and Paris')
        );
    });
});

Route::get('/tutorial/plan-execute-detailed', function () {
    $agent = new PlanExecuteDemoAgent;

    return response()->eventStream(function () use ($agent) {
        try {
            $agent
                ->allowReplan()
                ->maxSteps(10)
                ->maxReplans(2)
                ->onLoopStart(function (string $task) {
                    yield new StreamedEvent(
                        event: 'start',
                        data: ['task' => $task],
                    );
                })
                ->onPlanCreated(function (array $steps) {
                    yield new StreamedEvent(
                        event: 'plan',
                        data: [
                            'type' => 'initial',
                            'steps' => $steps,
                            'count' => count($steps),
                        ],
                    );
                })
                ->onBeforeStep(function (int $stepNumber, string $description, int $totalSteps) {
                    yield new StreamedEvent(
                        event: 'step',
                        data: [
                            'stage' => 'start',
                            'number' => $stepNumber,
                            'description' => $description,
                            'total' => $totalSteps,
                        ],
                    );
                })
                ->onAfterStep(function (int $stepNumber, string $description, $response, int $totalSteps) {
                    yield new StreamedEvent(
                        event: 'step',
                        data: [
                            'stage' => 'complete',
                            'number' => $stepNumber,
                            'description' => $description,
                            'result' => substr($response->text ?? '', 0, 200),
                            'total' => $totalSteps,
                        ],
                    );
                })
                ->onReplan(function (array $newSteps, int $replanCount) {
                    yield new StreamedEvent(
                        event: 'replan',
                        data: [
                            'attempt' => $replanCount,
                            'newSteps' => $newSteps,
                            'count' => count($newSteps),
                        ],
                    );
                })
                ->onBeforeSynthesis(function (array $stepResults) {
                    yield new StreamedEvent(
                        event: 'synthesis',
                        data: ['stage' => 'start', 'stepCount' => count($stepResults)],
                    );
                })
                ->onAfterSynthesis(function ($response) {
                    yield new StreamedEvent(
                        event: 'synthesis',
                        data: ['stage' => 'complete', 'text' => $response->text ?? ''],
                    );
                })
                ->onLoopComplete(function ($response, int $totalSteps) {
                    yield new StreamedEvent(
                        event: 'complete',
                        data: [
                            'stepsExecuted' => $totalSteps,
                            'text' => $response->text ?? 'Synthesis complete',
                            'conversationId' => $response->conversationId ?? null,
                        ],
                    );
                })
                ->onMaxStepsReached(function ($response, int $stepsExecuted) {
                    yield new StreamedEvent(
                        event: 'max_steps',
                        data: [
                            'stepsExecuted' => $stepsExecuted,
                            'text' => $response->text ?? 'Max steps reached',
                        ],
                    );
                });

            yield from $agent->planExecuteStream(
                request('task', 'Compare weather in Tokyo and London, then calculate which is warmer by how many degrees')
            );
        } catch (\Throwable $e) {
            logger()->error('Plan-Execute loop error', [
                'message' => $e->getMessage(),
                'file' => $e->getFile(),
                'line' => $e->getLine(),
            ]);

            yield new StreamedEvent(
                event: 'error',
                data: [
                    'message' => $e->getMessage(),
                    'type' => get_class($e),
                ],
            );
        }
    });
});

// ─── Chain-of-Thought Loop Examples ─────────────────────────────────────

Route::get('/tutorial/chain-of-thought-basic', function () {
    $agent = new ChainOfThoughtDemoAgent;

    return response()->eventStream(function () use ($agent) {
        try {
            $agent
                ->maxReasoningIterations(6)
                ->onIterationStart(function (int $iteration) {
                    yield new StreamedEvent(
                        event: 'iteration',
                        data: ['number' => $iteration, 'status' => 'started'],
                    );
                })
                ->onAfterReasoning(function ($response, int $iteration) {
                    yield new StreamedEvent(
                        event: 'reasoning',
                        data: [
                            'iteration' => $iteration,
                            'text' => $response->text,
                            'hasToolCalls' => $response->toolCalls->isNotEmpty(),
                        ],
                    );
                })
                ->onBeforeAction(function (string $tool, array $args, int $iteration) {
                    yield new StreamedEvent(
                        event: 'action',
                        data: [
                            'tool' => $tool,
                            'args' => $args,
                            'iteration' => $iteration,
                            'stage' => 'start',
                        ],
                    );
                })
                ->onAfterAction(function (string $tool, array $args, string $result, int $iteration) {
                    yield new StreamedEvent(
                        event: 'action',
                        data: [
                            'tool' => $tool,
                            'result' => $result,
                            'iteration' => $iteration,
                            'stage' => 'complete',
                        ],
                    );
                })
                ->onReflection(function (string $reflectionPrompt, int $iteration) {
                    yield new StreamedEvent(
                        event: 'reflection',
                        data: ['iteration' => $iteration],
                    );
                })
                ->onLoopComplete(function ($response, int $iterations) {
                    yield new StreamedEvent(
                        event: 'complete',
                        data: [
                            'text' => $response->text,
                            'iterations' => $iterations,
                        ],
                    );
                });

            yield from $agent->chainOfThoughtStream(
                request('message', 'If a train travels 120 miles in 2 hours and another travels 180 miles in 3 hours, which is faster and by how much?')
            );
        } catch (\Throwable $e) {
            logger()->error('Chain-of-Thought loop error', [
                'message' => $e->getMessage(),
                'file' => $e->getFile(),
                'line' => $e->getLine(),
            ]);

            yield new StreamedEvent(
                event: 'error',
                data: [
                    'message' => $e->getMessage(),
                    'type' => get_class($e),
                ],
            );
        }
    });
});

// ─── MCP Chat Demo Examples ─────────────────────────────────────────────

Route::get('/tutorial/mcp-chat-stream', function () {
    $agent = new McpChatDemoAgent;
    $conversationId = request()->input('conversation_id');

    // Create a guest user object for conversation tracking
    $guestUser = (object) [
        'id' => 'mcp-demo-guest-user',
        'name' => 'Guest',
    ];

    if ($conversationId) {
        $agent->continue($conversationId, $guestUser);
    } else {
        $agent->forUser($guestUser);
    }

    return response()->eventStream(function () use ($agent) {
        try {
            $agent
                ->onBeforeAction(function (string $tool, array $args, int $iteration) {
                    yield new StreamedEvent(
                        event: 'action',
                        data: [
                            'tool' => $tool,
                            'args' => $args,
                            'iteration' => $iteration,
                            'stage' => 'start',
                        ],
                    );
                })
                ->onAfterAction(function (string $tool, array $args, string $result, int $iteration) {
                    // Check if the result contains an elicitation request
                    $decoded = json_decode($result, true);
                    if (is_array($decoded) && ($decoded['status'] ?? '') === 'elicitation_required') {
                        yield new StreamedEvent(
                            event: 'elicitation',
                            data: [
                                'type' => $decoded['type'],
                                'elicitation_id' => $decoded['elicitation_id'],
                                'message' => $decoded['message'],
                                'requested_schema' => $decoded['requested_schema'] ?? null,
                                'url' => $decoded['url'] ?? null,
                                'tool' => $tool,
                                'iteration' => $iteration,
                            ],
                        );
                    }

                    yield new StreamedEvent(
                        event: 'action',
                        data: [
                            'tool' => $tool,
                            'result' => $result,
                            'iteration' => $iteration,
                            'stage' => 'complete',
                        ],
                    );
                })
                ->onObservation(function (string $observation, int $iteration) {
                    yield new StreamedEvent(
                        event: 'observation',
                        data: [
                            'text' => $observation,
                            'iteration' => $iteration,
                        ],
                    );
                })
                ->onLoopComplete(function ($response, int $iterations) {
                    yield new StreamedEvent(
                        event: 'complete',
                        data: [
                            'text' => $response->text,
                            'iterations' => $iterations,
                            'conversationId' => $response->conversationId,
                        ],
                    );
                });

            yield from $agent->reactLoopStream(request()->input('message', 'Hello!'));
        } catch (\Throwable $e) {
            logger()->error('MCP Chat error', [
                'message' => $e->getMessage(),
                'file' => $e->getFile(),
                'line' => $e->getLine(),
            ]);

            yield new StreamedEvent(
                event: 'error',
                data: [
                    'message' => $e->getMessage(),
                    'type' => get_class($e),
                ],
            );
        }
    });
});

// Handle elicitation form submission (simulates MCP elicitation response)
Route::post('/tutorial/mcp-chat-elicitation', function () {
    $action = request()->input('action', 'accept');
    $data = request()->input('data', []);
    $elicitationId = request()->input('elicitation_id');
    $tool = request()->input('tool');

    // Store generic elicitation response by tool so demo tools can continue after form/url completion.
    if ($action === 'accept' && ! empty($tool)) {
        Cache::put("mcp_demo_elicitation_{$tool}", [
            'tool' => $tool,
            'data' => $data,
            'stored_at' => now()->toIso8601String(),
        ], now()->addMinutes(30));
    }

    if ($action === 'accept' && ! empty($data)) {
        // Store the actual credentials in cache (simulates MCP server receiving elicitation response)
        Cache::put('mcp_demo_cloud_credentials', [
            'api_key' => $data['api_key'] ?? null,
            'region' => $data['region'] ?? null,
            'auto_scale' => $data['auto_scale'] ?? true,
            'stored_at' => now()->toIso8601String(),
        ], now()->addMinutes(30));
    }

    return response()->json([
        'status' => 'ok',
        'action' => $action,
        'tool' => $tool,
        'elicitation_id' => $elicitationId,
        'credentials_stored' => $action === 'accept',
        'data' => $action === 'accept' ? $data : null,
    ]);
});

// Reset credentials (for demo purposes)
Route::post('/tutorial/mcp-chat-reset', function () {
    Cache::forget('mcp_demo_cloud_credentials');
    Cache::forget('mcp_demo_elicitation_deploy_project');
    Cache::forget('mcp_demo_elicitation_security_review');
    Cache::forget('mcp_demo_elicitation_connect_repository');
    Cache::forget('mcp_demo_elicitation_incident_escalation');

    return response()->json(['status' => 'ok', 'message' => 'Cloud credentials cleared']);
});
