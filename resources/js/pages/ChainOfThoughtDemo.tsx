import { Head } from '@inertiajs/react';
import { useEventStream } from '@laravel/stream-react';
import { useState, useCallback, useRef, useEffect } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────

type ReasoningIteration = {
    number: number;
    status: 'active' | 'reflecting' | 'completed';
    reasoning?: string;
    toolCalls?: Array<{ tool: string; args: any; result?: string }>;
    reflection?: boolean;
};

type Event = {
    id: number;
    timestamp: string;
    type: string;
    data: any;
};

// ─── Main Component ─────────────────────────────────────────────────────────

export default function ChainOfThoughtDemo() {
    const [input, setInput] = useState('If a train travels 120 miles in 2 hours and another travels 180 miles in 3 hours, which is faster and by how much?');
    const [streamUrl, setStreamUrl] = useState('');
    const [isRunning, setIsRunning] = useState(false);
    const [iterations, setIterations] = useState<ReasoningIteration[]>([]);
    const [finalResult, setFinalResult] = useState('');
    const [events, setEvents] = useState<Event[]>([]);
    const [showEvents, setShowEvents] = useState(false);
    const contentEndRef = useRef<HTMLDivElement>(null);
    const eventsEndRef = useRef<HTMLDivElement>(null);
    const eventIdRef = useRef(0);

    // Auto-scroll
    useEffect(() => {
        contentEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [iterations, finalResult]);

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
        
        if (event.type === 'iteration') {
            if (eventData.status === 'started') {
                setIterations(prev => [...prev, {
                    number: eventData.number,
                    status: 'active',
                }]);
            }
        } else if (event.type === 'reasoning') {
            setIterations(prev => {
                const updated = [...prev];
                const idx = updated.findIndex(i => i.number === eventData.iteration);
                if (idx >= 0) {
                    updated[idx] = {
                        ...updated[idx],
                        reasoning: eventData.text,
                        toolCalls: eventData.hasToolCalls ? [] : undefined,
                    };
                }
                return updated;
            });
        } else if (event.type === 'action') {
            if (eventData.stage === 'start') {
                setIterations(prev => {
                    const updated = [...prev];
                    const idx = updated.findIndex(i => i.number === eventData.iteration);
                    if (idx >= 0) {
                        const currentToolCalls = updated[idx].toolCalls || [];
                        updated[idx] = {
                            ...updated[idx],
                            toolCalls: [...currentToolCalls, {
                                tool: eventData.tool,
                                args: eventData.args,
                            }],
                        };
                    }
                    return updated;
                });
            } else if (eventData.stage === 'complete') {
                setIterations(prev => {
                    const updated = [...prev];
                    const idx = updated.findIndex(i => i.number === eventData.iteration);
                    if (idx >= 0 && updated[idx].toolCalls) {
                        const toolCalls = [...updated[idx].toolCalls!];
                        const toolIdx = toolCalls.findIndex(t => t.tool === eventData.tool && !t.result);
                        if (toolIdx >= 0) {
                            toolCalls[toolIdx] = {
                                ...toolCalls[toolIdx],
                                result: eventData.result,
                            };
                        }
                        updated[idx] = {
                            ...updated[idx],
                            toolCalls,
                        };
                    }
                    return updated;
                });
            }
        } else if (event.type === 'reflection') {
            setIterations(prev => {
                const updated = [...prev];
                const idx = updated.findIndex(i => i.number === eventData.iteration);
                if (idx >= 0) {
                    updated[idx] = {
                        ...updated[idx],
                        status: 'reflecting',
                        reflection: true,
                    };
                }
                return updated;
            });
        } else if (event.type === 'complete') {
            setIterations(prev => prev.map(i => ({
                ...i,
                status: 'completed',
            })));
            setFinalResult(eventData.text);
        }
    }, []);

    const handleComplete = useCallback(() => {
        setIsRunning(false);
        setStreamUrl('');
    }, []);

    const handleError = useCallback(() => {
        setIsRunning(false);
        setStreamUrl('');
        
        if (iterations.some(i => i.reasoning)) {
            // We got some reasoning, show partial results
            const completedCount = iterations.filter(i => i.status === 'completed').length;
            setFinalResult(`Stream ended after ${completedCount} iteration(s). Partial reasoning shown above.`);
        } else if (events.length > 0) {
            setFinalResult('Stream interrupted. Check the events log for progress made.');
        } else {
            setFinalResult('Error: Stream failed to start. Please check console and try again.');
        }
    }, [iterations, events.length]);

    const handleStart = () => {
        setIterations([]);
        setFinalResult('');
        setEvents([]);
        eventIdRef.current = 0;
        setIsRunning(true);
        const params = new URLSearchParams({ message: input });
        setStreamUrl(`/tutorial/chain-of-thought-basic?${params.toString()}`);
    };

    const handleStop = () => {
        setIsRunning(false);
        setStreamUrl('');
    };

    const handleClear = () => {
        setIterations([]);
        setFinalResult('');
        setEvents([]);
        eventIdRef.current = 0;
    };

    return (
        <>
            <Head title="Tutorial: Chain-of-Thought Loop" />

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
                                <h1 className="text-3xl font-bold text-foreground">Chain-of-Thought Reasoning Demo</h1>
                                <p className="mt-2 text-muted-foreground">
                                    Watch iterative self-reflection and deep reasoning in real-time
                                </p>
                            </div>
                            <button
                                onClick={() => setShowEvents(!showEvents)}
                                className="rounded-lg border border-input px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
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
                                    Problem to Reason Through
                                </label>
                                <div className="flex gap-3">
                                    <input
                                        type="text"
                                        value={input}
                                        onChange={(e) => setInput(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !isRunning) handleStart();
                                        }}
                                        placeholder="What problem should the agent reason through?"
                                        disabled={isRunning}
                                        className="flex-1 rounded-lg border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                                    />
                                    {isRunning ? (
                                        <button
                                            onClick={handleStop}
                                            className="rounded-lg bg-destructive/10 px-6 py-3 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/20"
                                        >
                                            Stop
                                        </button>
                                    ) : (
                                        <button
                                            onClick={handleStart}
                                            disabled={!input.trim()}
                                            className="rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                                        >
                                            Start Reasoning
                                        </button>
                                    )}
                                    {iterations.length > 0 && !isRunning && (
                                        <button
                                            onClick={handleClear}
                                            className="rounded-lg border border-input px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                                        >
                                            Clear
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Reasoning Iterations */}
                            {iterations.map((iteration) => (
                                <ReasoningCard key={iteration.number} iteration={iteration} />
                            ))}

                            {/* Final Result */}
                            {finalResult && (
                                <div className="rounded-xl border-2 border-green-500/50 bg-green-50 p-6 shadow-sm dark:bg-green-950/30">
                                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-green-700 dark:text-green-400">
                                        <span>✓</span>
                                        <span>Final Answer</span>
                                    </div>
                                    <div className="whitespace-pre-wrap text-foreground">{finalResult}</div>
                                </div>
                            )}

                            {/* Empty State */}
                            {iterations.length === 0 && !isRunning && (
                                <div className="rounded-xl border border-border bg-card p-12 text-center shadow-sm">
                                    <div className="mb-4 text-5xl">🧠</div>
                                    <p className="text-muted-foreground">
                                        Click "Start Reasoning" to watch deep Chain-of-Thought reasoning in action
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

// ─── Reasoning Card Component ───────────────────────────────────────────────

function ReasoningCard({ iteration }: { iteration: ReasoningIteration }) {
    return (
        <div className={`rounded-xl border-2 p-6 shadow-sm ${
            iteration.status === 'active'
                ? 'border-blue-500/50 bg-blue-50 dark:bg-blue-950/30'
                : iteration.status === 'reflecting'
                ? 'border-purple-500/50 bg-purple-50 dark:bg-purple-950/30'
                : 'border-gray-300/50 bg-gray-50 dark:bg-gray-950/30'
        }`}>
            {/* Header */}
            <div className="mb-4 flex items-center gap-3">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    iteration.status === 'active'
                        ? 'animate-pulse bg-blue-500 text-white'
                        : iteration.status === 'reflecting'
                        ? 'bg-purple-500 text-white'
                        : 'bg-gray-400 text-white'
                }`}>
                    {iteration.status === 'completed' ? '✓' : iteration.number}
                </div>
                <div>
                    <h3 className="font-semibold text-foreground">
                        Reasoning Iteration {iteration.number}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                        {iteration.status === 'active' ? 'Thinking...' :
                         iteration.status === 'reflecting' ? 'Reflecting on understanding' :
                         'Completed'}
                    </p>
                </div>
            </div>

            {/* Reasoning Text */}
            {iteration.reasoning && (
                <div className="mb-4 rounded-lg bg-background/50 p-4">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        💭 Reasoning
                    </div>
                    <div className="whitespace-pre-wrap text-sm text-foreground">
                        {iteration.reasoning}
                    </div>
                </div>
            )}

            {/* Tool Calls */}
            {iteration.toolCalls && iteration.toolCalls.length > 0 && (
                <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        🔧 Tool Calls
                    </div>
                    {iteration.toolCalls.map((call, idx) => (
                        <div key={idx} className="rounded-lg border border-border bg-background/70 p-3">
                            <div className="mb-1 flex items-center gap-2">
                                <span className="font-mono text-sm font-semibold text-foreground">
                                    {call.tool}
                                </span>
                                {!call.result && (
                                    <span className="animate-pulse text-xs text-muted-foreground">
                                        executing...
                                    </span>
                                )}
                            </div>
                            <div className="mb-1 font-mono text-xs text-muted-foreground">
                                {JSON.stringify(call.args)}
                            </div>
                            {call.result && (
                                <div className="mt-2 border-t border-border pt-2 text-xs text-foreground">
                                    <span className="font-semibold">Result:</span> {call.result}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Reflection Indicator */}
            {iteration.reflection && (
                <div className="mt-4 rounded-lg border border-purple-500/30 bg-purple-100/50 p-3 dark:bg-purple-900/20">
                    <div className="flex items-center gap-2 text-sm text-purple-700 dark:text-purple-300">
                        <span>🤔</span>
                        <span className="font-medium">Reflecting on understanding and confidence...</span>
                    </div>
                </div>
            )}
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
        eventName: ['iteration', 'reasoning', 'action', 'reflection', 'complete', 'max_iterations', 'error'],
        onMessage: onEvent,
        onComplete,
        onError: handleError,
    });

    return null;
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function getEventColor(type: string): string {
    const colors: Record<string, string> = {
        iteration: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
        reasoning: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300',
        action: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
        reflection: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
        complete: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
        max_iterations: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    };
    return colors[type] || 'bg-gray-100 text-gray-800 dark:bg-gray-800/40 dark:text-gray-300';
}
