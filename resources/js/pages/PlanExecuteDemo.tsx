import { Head } from '@inertiajs/react';
import { useEventStream } from '@laravel/stream-react';
import { useState, useCallback, useRef, useEffect } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────

type PlanStep = {
    number: number;
    description: string;
    status: 'pending' | 'executing' | 'completed';
    result?: string;
};

type Plan = {
    type: 'initial' | 'replan';
    steps: PlanStep[];
    replanAttempt?: number;
};

type Event = {
    id: number;
    timestamp: string;
    type: string;
    data: any;
};

// ─── Main Component ─────────────────────────────────────────────────────────

export default function PlanExecuteDemo() {
    const [input, setInput] = useState('Compare weather in Tokyo and London, then calculate which is warmer by how many degrees');
    const [streamUrl, setStreamUrl] = useState('');
    const [isRunning, setIsRunning] = useState(false);
    const [plans, setPlans] = useState<Plan[]>([]);
    const [currentSteps, setCurrentSteps] = useState<PlanStep[]>([]);
    const [synthesis, setSynthesis] = useState<{ stage: 'start' | 'complete'; text?: string } | null>(null);
    const [finalResult, setFinalResult] = useState('');
    const [events, setEvents] = useState<Event[]>([]);
    const [showEvents, setShowEvents] = useState(false);
    const contentEndRef = useRef<HTMLDivElement>(null);
    const eventsEndRef = useRef<HTMLDivElement>(null);
    const eventIdRef = useRef(0);

    // Auto-scroll
    useEffect(() => {
        contentEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [plans, currentSteps, synthesis]);

    useEffect(() => {
        if (showEvents) {
            eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [events, showEvents]);

    const handleEvent = useCallback((event: MessageEvent) => {
        const eventData = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;

        // Add to event log
        setEvents(prev => [...prev, {
            id: eventIdRef.current++,
            timestamp: new Date().toLocaleTimeString('en-US', { hour12: false, fractionalSecondDigits: 3 }),
            type: event.type || 'update',
            data: eventData,
        }]);

        // Handle different event types
        if (event.type === 'error') {
            setFinalResult(`Error: ${eventData.message || 'Unknown error occurred'}`);
            setIsRunning(false);
            return;
        }
        
        if (event.type === 'plan') {
            const newPlan: Plan = {
                type: eventData.type === 'initial' ? 'initial' : 'replan',
                steps: eventData.steps.map((desc: string, idx: number) => ({
                    number: idx + 1,
                    description: desc,
                    status: 'pending' as const,
                })),
                replanAttempt: eventData.type !== 'initial' ? plans.length : undefined,
            };
            setPlans(prev => [...prev, newPlan]);
            setCurrentSteps(newPlan.steps);
        } else if (event.type === 'replan') {
            const newPlan: Plan = {
                type: 'replan',
                steps: eventData.newSteps.map((desc: string, idx: number) => ({
                    number: idx + 1,
                    description: desc,
                    status: 'pending' as const,
                })),
                replanAttempt: eventData.attempt,
            };
            setPlans(prev => [...prev, newPlan]);
            setCurrentSteps(newPlan.steps);
        } else if (event.type === 'step') {
            if (eventData.stage === 'start') {
                setCurrentSteps(prev => prev.map(step =>
                    step.number === eventData.number
                        ? { ...step, status: 'executing' }
                        : step
                ));
            } else if (eventData.stage === 'complete') {
                setCurrentSteps(prev => prev.map(step =>
                    step.number === eventData.number
                        ? { ...step, status: 'completed', result: eventData.result }
                        : step
                ));
            }
        } else if (event.type === 'synthesis') {
            if (eventData.stage === 'start') {
                setSynthesis({ stage: 'start' });
            } else if (eventData.stage === 'complete') {
                setSynthesis({ stage: 'complete', text: eventData.text });
            }
        } else if (event.type === 'complete') {
            setFinalResult(eventData.text);
        }
    }, [plans.length]);

    const handleComplete = useCallback(() => {
        setIsRunning(false);
        setStreamUrl('');
        
        // If we have synthesis, use it as the final result
        if (synthesis?.text && !finalResult) {
            setFinalResult(synthesis.text);
        }
    }, [synthesis, finalResult]);

    const handleError = useCallback(() => {
        setIsRunning(false);
        setStreamUrl('');
        
        // Check if we completed successfully but just lost connection
        if (synthesis?.text) {
            // We got synthesis, treat it as success
            setFinalResult(synthesis.text);
        } else if (currentSteps.some(s => s.status === 'completed')) {
            // We completed some steps, show partial results
            const completedCount = currentSteps.filter(s => s.status === 'completed').length;
            setFinalResult(`Stream ended after completing ${completedCount}/${currentSteps.length} steps. Partial results shown above.`);
        } else if (events.length > 0) {
            setFinalResult('Stream interrupted. Check the events log for progress made.');
        } else {
            setFinalResult('Error: Stream failed to start. Please check console and try again.');
        }
    }, [synthesis, currentSteps, events.length]);

    const handleStart = () => {
        setPlans([]);
        setCurrentSteps([]);
        setSynthesis(null);
        setFinalResult('');
        setEvents([]);
        eventIdRef.current = 0;
        setIsRunning(true);
        const params = new URLSearchParams({ task: input });
        setStreamUrl(`/tutorial/plan-execute-detailed?${params.toString()}`);
    };

    const handleStop = () => {
        setIsRunning(false);
        setStreamUrl('');
    };

    const handleClear = () => {
        setPlans([]);
        setCurrentSteps([]);
        setSynthesis(null);
        setFinalResult('');
        setEvents([]);
        eventIdRef.current = 0;
    };

    return (
        <>
            <Head title="Tutorial: Plan-Execute Loop" />

            {streamUrl && (
                <StreamListener
                    url={streamUrl}
                    onEvent={handleEvent}
                    onComplete={handleComplete}
                    onError={handleError}
                />
            )}

            <div className="min-h-screen bg-background p-6">
                <div className="mx-auto max-w-7xl">
                    {/* Header */}
                    <div className="mb-6">
                        <div className="flex items-start justify-between">
                            <div>
                                <h1 className="text-3xl font-bold text-foreground">Plan-Execute Loop Demo</h1>
                                <p className="mt-2 text-muted-foreground">
                                    Watch multi-step planning, execution, and synthesis in real-time
                                </p>
                            </div>
                            <button
                                onClick={() => setShowEvents(!showEvents)}
                                className="whitespace-nowrap rounded-lg border border-input px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                            >
                                {showEvents ? 'Hide' : 'Show'} Events
                            </button>
                        </div>
                    </div>

                    <div className="grid gap-6" style={{ gridTemplateColumns: showEvents ? '2fr 1fr' : '1fr' }}>
                        {/* Main Content */}
                        <div className="space-y-6">
                            {/* Input */}
                            <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
                                <label className="mb-3 block text-sm font-medium text-foreground">
                                    Task
                                </label>
                                <div className="flex gap-3">
                                    <input
                                        type="text"
                                        value={input}
                                        onChange={(e) => setInput(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !isRunning) handleStart();
                                        }}
                                        placeholder="What task should the agent plan and execute?"
                                        disabled={isRunning}
                                        className="flex-1 rounded-lg border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                                    />
                                    {isRunning ? (
                                        <button
                                            onClick={handleStop}
                                            className="whitespace-nowrap rounded-lg bg-destructive/10 px-6 py-3 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/20"
                                        >
                                            Stop
                                        </button>
                                    ) : (
                                        <button
                                            onClick={handleStart}
                                            disabled={!input.trim()}
                                            className="whitespace-nowrap rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                                        >
                                            Start Planning
                                        </button>
                                    )}
                                    {plans.length > 0 && !isRunning && (
                                        <button
                                            onClick={handleClear}
                                            className="rounded-lg border border-input px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                                        >
                                            Clear
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Plans */}
                            {plans.map((plan, planIdx) => (
                                <PlanCard
                                    key={planIdx}
                                    plan={plan}
                                    isActive={planIdx === plans.length - 1}
                                    currentSteps={planIdx === plans.length - 1 ? currentSteps : undefined}
                                />
                            ))}

                            {/* Synthesis */}
                            {synthesis && (
                                <div className={`rounded-xl border-2 p-6 shadow-sm ${
                                    synthesis.stage === 'start'
                                        ? 'border-violet-500/50 bg-violet-50 dark:bg-violet-950/30'
                                        : 'border-violet-500/50 bg-violet-50 dark:bg-violet-950/30'
                                }`}>
                                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-violet-700 dark:text-violet-400">
                                        <span>🔮</span>
                                        <span>Synthesis</span>
                                        {synthesis.stage === 'start' && (
                                            <span className="ml-2 animate-pulse text-xs text-muted-foreground">
                                                Combining results...
                                            </span>
                                        )}
                                    </div>
                                    {synthesis.text && (
                                        <div className="whitespace-pre-wrap text-foreground">{synthesis.text}</div>
                                    )}
                                </div>
                            )}

                            {/* Final Result */}
                            {finalResult && (
                                <div className="rounded-xl border-2 border-green-500/50 bg-green-50 p-6 shadow-sm dark:bg-green-950/30">
                                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-green-700 dark:text-green-400">
                                        <span>✓</span>
                                        <span>Final Result</span>
                                    </div>
                                    <div className="whitespace-pre-wrap text-foreground">{finalResult}</div>
                                </div>
                            )}

                            {/* Empty State */}
                            {plans.length === 0 && !isRunning && (
                                <div className="rounded-xl border border-border bg-card p-12 text-center shadow-sm">
                                    <div className="mb-4 text-5xl">📋</div>
                                    <p className="text-muted-foreground">
                                        Click "Start Planning" to see the Plan-Execute cycle in action
                                    </p>
                                </div>
                            )}

                            <div ref={contentEndRef} />
                        </div>

                        {/* Event Log */}
                        {showEvents && (
                            <div className="rounded-xl border border-border bg-card shadow-sm" style={{ height: 'calc(100vh - 220px)' }}>
                                <div className="border-b border-border px-4 py-3">
                                    <h3 className="font-semibold text-foreground">Event Log</h3>
                                </div>
                                <div className="overflow-y-auto p-3" style={{ height: 'calc(100% - 57px)' }}>
                                    {events.length === 0 ? (
                                        <p className="text-center text-sm text-muted-foreground">No events yet</p>
                                    ) : (
                                        <div className="space-y-1 font-mono text-xs">
                                            {events.map((event) => (
                                                <div key={event.id} className="rounded bg-muted/50 p-2">
                                                    <div className="mb-1 flex items-center gap-2">
                                                        <span className="text-muted-foreground">{event.timestamp}</span>
                                                        <span className={`rounded px-1.5 py-0.5 font-semibold ${getEventColor(event.type)}`}>
                                                            {event.type}
                                                        </span>
                                                    </div>
                                                    <div className="text-foreground/70">
                                                        {JSON.stringify(event.data, null, 2)}
                                                    </div>
                                                </div>
                                            ))}
                                            <div ref={eventsEndRef} />
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}

// ─── Plan Card Component ────────────────────────────────────────────────────

function PlanCard({
    plan,
    isActive,
    currentSteps,
}: {
    plan: Plan;
    isActive: boolean;
    currentSteps?: PlanStep[];
}) {
    const steps = currentSteps || plan.steps;

    return (
        <div className={`rounded-xl border-2 shadow-sm ${
            plan.type === 'initial'
                ? 'border-indigo-500/50 bg-indigo-50 dark:bg-indigo-950/30'
                : 'border-orange-500/50 bg-orange-50 dark:bg-orange-950/30'
        }`}>
            {/* Header */}
            <div className="border-b border-border px-6 py-4">
                <div className="flex items-center gap-3">
                    <span className="text-2xl">{plan.type === 'initial' ? '📋' : '🔄'}</span>
                    <div>
                        <h3 className="font-semibold text-foreground">
                            {plan.type === 'initial' ? 'Initial Plan' : `Replan #${plan.replanAttempt}`}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                            {steps.length} step{steps.length !== 1 ? 's' : ''}
                        </p>
                    </div>
                </div>
            </div>

            {/* Steps */}
            <div className="space-y-3 p-6">
                {steps.map((step) => (
                    <div key={step.number} className="flex gap-3">
                        {/* Step Number */}
                        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                            step.status === 'completed' ? 'bg-green-500 text-white' :
                            step.status === 'executing' ? 'animate-pulse bg-blue-500 text-white' :
                            'bg-muted text-muted-foreground'
                        }`}>
                            {step.status === 'completed' ? '✓' : step.number}
                        </div>

                        {/* Step Content */}
                        <div className="flex-1">
                            <div className={`rounded-lg p-3 ${
                                step.status === 'completed' ? 'bg-background/50' :
                                step.status === 'executing' ? 'bg-background/70' :
                                'bg-background/30'
                            }`}>
                                <div className="text-sm text-foreground">{step.description}</div>
                                {step.result && (
                                    <div className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                                        {step.result}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── Stream Listener ────────────────────────────────────────────────────────

function StreamListener({
    url,
    onEvent,
    onComplete,
    onError,
}: {
    url: string;
    onEvent: (event: MessageEvent) => void;
    onComplete: () => void;
    onError: () => void;
}) {
    // Wrap error handler to filter out @laravel/stream-react bugs
    const handleError = (error?: any) => {
        // Check if this is the known "Cannot read properties of undefined (reading 'startsWith')" error
        // This happens when the stream closes normally but the library has a bug
        if (error?.message?.includes('startsWith') || error?.type === 'error') {
            console.log('Stream closed (EventSource error event - likely normal closure)');
            // Treat as completion instead of error
            onComplete();
        } else {
            console.error('Stream error:', error);
            onError();
        }
    };

    useEventStream(url, {
        eventName: ['start', 'plan', 'step', 'replan', 'synthesis', 'complete', 'max_steps', 'error'],
        onMessage: onEvent,
        onComplete,
        onError: handleError,
    });

    return null;
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function getEventColor(type: string): string {
    const colors: Record<string, string> = {
        start: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
        plan: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
        step: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300',
        replan: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
        synthesis: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300',
        complete: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
        max_steps: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    };
    return colors[type] || 'bg-gray-100 text-gray-800 dark:bg-gray-800/40 dark:text-gray-300';
}
