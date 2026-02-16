<?php

use App\Agents\ChainOfThoughtDemoAgent;
use App\Agents\MakerDemoAgent;
use App\Agents\PlanExecuteDemoAgent;
use App\Agents\ReActDemoAgent;
use App\Agents\TutorialChatAgent;
use Illuminate\Http\StreamedEvent;
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

    Route::get('/maker-loop', function () {
        return Inertia::render('MakerLoopDemo');
    })->name('tutorial.maker-loop');
});

// ─── Complete Example: Chat Agent with Conversation ─────────────────────

Route::get('/tutorial/complete-example', function () {
    $agent = new TutorialChatAgent;
    $conversationId = request()->input('conversation_id');

    if ($conversationId) {
        $agent->withConversation($conversationId);
    }

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

// ─── MAKER Loop Examples ─────────────────────────────────────────────

Route::post('/tutorial/maker-loop-basic', function () {
    set_time_limit(120); // Allow 2 minutes for MAKER loop
    
    return response()->eventStream(function () {
        try {
            $agent = new MakerDemoAgent;

            $agent
                ->votingK(2)
                ->enableRedFlagging(true)
                ->maxDecompositionDepth(2) // Reduced to prevent timeout
                ->onLoopStart(function (string $prompt) {
                    yield new StreamedEvent(
                        event: 'start',
                        data: ['prompt' => $prompt],
                    );
                })
                ->onLoopComplete(function ($response, int $steps) {
                    yield new StreamedEvent(
                        event: 'complete',
                        data: [
                            'text' => $response->text,
                            'total_steps' => $steps,
                        ],
                    );
                });

            $result = yield from $agent->makerLoopStream(
                request('message', 'Calculate 5! step by step')
            );

            yield new StreamedEvent(
                event: 'result',
                data: [
                    'text' => $result->text(),
                    'stats' => $result->executionStats,
                    'error_rate' => $result->errorRate(),
                ],
            );
        } catch (\Throwable $e) {
            logger()->error('MAKER loop basic error', [
                'message' => $e->getMessage(),
                'file' => $e->getFile(),
                'line' => $e->getLine(),
            ]);

            yield new StreamedEvent(
                event: 'error',
                data: ['message' => $e->getMessage()],
            );
        }
    });
});

Route::post('/tutorial/maker-loop-detailed', function () {
    set_time_limit(120); // Allow 2 minutes for MAKER loop
    
    return response()->eventStream(function () {
        try {
            $agent = new MakerDemoAgent;

            $agent
                ->votingK((int) request('voting_k', 2)) // Default to K=2 for speed
                ->enableRedFlagging((bool) request('red_flagging', true))
                ->maxDecompositionDepth((int) request('max_depth', 2)) // Default to 2 for speed
                ->maxMakerIterations((int) request('max_iterations', 50)) // Reduced default
                ->onLoopStart(function (string $prompt) {
                    yield new StreamedEvent(
                        event: 'start',
                        data: [
                            'prompt' => $prompt,
                            'stage' => 'starting',
                        ],
                    );
                })
                ->onDecomposition(function (array $subtasks, int $depth, int $iteration) {
                    yield new StreamedEvent(
                        event: 'decomposition',
                        data: [
                            'subtasks' => $subtasks,
                            'count' => count($subtasks),
                            'depth' => $depth,
                            'iteration' => $iteration,
                        ],
                    );
                })
                ->onBeforeVote(function (string $prompt, int $voteNum, int $iteration) {
                    yield new StreamedEvent(
                        event: 'vote',
                        data: [
                            'vote_number' => $voteNum,
                            'iteration' => $iteration,
                            'stage' => 'before',
                        ],
                    );
                })
                ->onAfterVote(function (string $response, int $voteNum, int $iteration) {
                    yield new StreamedEvent(
                        event: 'vote',
                        data: [
                            'vote_number' => $voteNum,
                            'iteration' => $iteration,
                            'stage' => 'after',
                            'response_preview' => substr($response, 0, 100),
                        ],
                    );
                })
                ->onConsensus(function (string $winner, int $votes, int $iteration) {
                    yield new StreamedEvent(
                        event: 'consensus',
                        data: [
                            'votes' => $votes,
                            'iteration' => $iteration,
                            'winner_preview' => substr($winner, 0, 100),
                        ],
                    );
                })
                ->onRedFlag(function (string $response, float $score, int $iteration) {
                    yield new StreamedEvent(
                        event: 'red_flag',
                        data: [
                            'score' => $score,
                            'iteration' => $iteration,
                            'response_preview' => substr($response, 0, 100),
                        ],
                    );
                })
                ->onAtomicExecution(function (string $task, string $result, int $iteration) {
                    yield new StreamedEvent(
                        event: 'atomic_execution',
                        data: [
                            'task' => substr($task, 0, 100),
                            'result' => substr($result, 0, 100),
                            'iteration' => $iteration,
                        ],
                    );
                })
                ->onComposition(function (string $task, string $result, int $iteration) {
                    yield new StreamedEvent(
                        event: 'composition',
                        data: [
                            'task' => substr($task, 0, 100),
                            'result' => substr($result, 0, 100),
                            'iteration' => $iteration,
                        ],
                    );
                })
                ->onLoopComplete(function ($response, int $steps) {
                    yield new StreamedEvent(
                        event: 'complete',
                        data: [
                            'text' => $response->text,
                            'total_steps' => $steps,
                        ],
                    );
                });

            $result = yield from $agent->makerLoopStream(
                request('message', 'Calculate (5! + 3!) × 2')
            );

            yield new StreamedEvent(
                event: 'final_result',
                data: [
                    'text' => $result->text(),
                    'stats' => $result->executionStats,
                    'error_rate' => $result->errorRate(),
                    'max_depth' => $result->maxDepthReached(),
                    'step_summaries' => $result->stepSummaries(),
                ],
            );
        } catch (\Throwable $e) {
            logger()->error('MAKER loop detailed error', [
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

Route::post('/tutorial/maker-loop-streaming', function () {
    set_time_limit(120); // Allow 2 minutes for MAKER loop
    
    return response()->eventStream(function () {
        try {
            $agent = new MakerDemoAgent;

            $agent
                ->votingK(2)
                ->enableRedFlagging(true)
                ->maxDecompositionDepth(2) // Reduced to prevent timeout
                ->onBeforeVote(function () {
                    yield new StreamedEvent(
                        event: 'progress',
                        data: ['status' => 'voting'],
                    );
                })
                ->onConsensus(function () {
                    yield new StreamedEvent(
                        event: 'progress',
                        data: ['status' => 'consensus_reached'],
                    );
                })
                ->onAtomicExecution(function ($task, $result) {
                    yield new StreamedEvent(
                        event: 'progress',
                        data: [
                            'status' => 'executed',
                            'result_preview' => substr($result, 0, 50),
                        ],
                    );
                });

            $result = yield from $agent->makerLoopStream(
                request('message', 'Calculate 6! step by step')
            );

            yield new StreamedEvent(
                event: 'final',
                data: [
                    'text' => $result->text(),
                    'steps' => $result->totalSteps,
                    'error_rate' => $result->errorRate(),
                ],
            );
        } catch (\Throwable $e) {
            logger()->error('MAKER loop streaming error', [
                'message' => $e->getMessage(),
            ]);

            yield new StreamedEvent(
                event: 'error',
                data: ['message' => $e->getMessage()],
            );
        }
    });
});

Route::post('/tutorial/maker-loop-comparison', function () {
    set_time_limit(180); // Allow 3 minutes for comparison (runs 2 loops)
    
    return response()->eventStream(function () {
        try {
            $task = request('message', 'Calculate 5!');
            $results = [];

            // Test with K=2
            yield new StreamedEvent(
                event: 'testing',
                data: ['k' => 2, 'stage' => 'starting'],
            );

            $agentK2 = new MakerDemoAgent;
            $resultK2 = $agentK2
                ->votingK(2)
                ->maxDecompositionDepth(1) // Very limited for speed
                ->makerLoop($task);

            $results['k2'] = [
                'text' => $resultK2->text(),
                'votes_cast' => $resultK2->executionStats['votes_cast'],
                'error_rate' => $resultK2->errorRate(),
                'steps' => $resultK2->totalSteps,
            ];

            yield new StreamedEvent(
                event: 'result',
                data: ['k' => 2, 'result' => $results['k2']],
            );

            // Test with K=3
            yield new StreamedEvent(
                event: 'testing',
                data: ['k' => 3, 'stage' => 'starting'],
            );

            $agentK3 = new MakerDemoAgent;
            $resultK3 = $agentK3
                ->votingK(3)
                ->maxDecompositionDepth(1) // Very limited for speed
                ->makerLoop($task);

            $results['k3'] = [
                'text' => $resultK3->text(),
                'votes_cast' => $resultK3->executionStats['votes_cast'],
                'error_rate' => $resultK3->errorRate(),
                'steps' => $resultK3->totalSteps,
            ];

            yield new StreamedEvent(
                event: 'result',
                data: ['k' => 3, 'result' => $results['k3']],
            );

            // Send comparison summary
            yield new StreamedEvent(
                event: 'comparison',
                data: [
                    'results' => $results,
                    'analysis' => [
                        'k3_more_votes' => $results['k3']['votes_cast'] > $results['k2']['votes_cast'],
                        'k3_lower_error' => $results['k3']['error_rate'] <= $results['k2']['error_rate'],
                    ],
                ],
            );
        } catch (\Throwable $e) {
            logger()->error('MAKER loop comparison error', [
                'message' => $e->getMessage(),
            ]);

            yield new StreamedEvent(
                event: 'error',
                data: ['message' => $e->getMessage()],
            );
        }
    });
});
