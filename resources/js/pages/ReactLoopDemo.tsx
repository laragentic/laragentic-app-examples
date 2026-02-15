import { Head } from '@inertiajs/react';
import { useEventStream } from '@laravel/stream-react';
import { useState, useCallback, useRef, useEffect } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────

type Iteration = {
    number: number;
    status: 'started' | 'thinking' | 'acting' | 'observing' | 'completed';
    thought?: string;
    actions: Array<{ tool: string; args: any; result?: string }>;
    observation?: string;
};

type Event = {
    id: number;
    timestamp: string;
    type: string;
    data: any;
};

// ─── Main Component ─────────────────────────────────────────────────────────

export default function ReactLoopDemo() {
    const [input, setInput] = useState('Search for Laravel AI SDK and calculate 42 * 7');
    const [streamUrl, setStreamUrl] = useState('');
    const [isRunning, setIsRunning] = useState(false);
    const [iterations, setIterations] = useState<Iteration[]>([]);
    const [finalAnswer, setFinalAnswer] = useState('');
    const [events, setEvents] = useState<Event[]>([]);
    const [showEvents, setShowEvents] = useState(false);
    const iterationsEndRef = useRef<HTMLDivElement>(null);
    const eventsEndRef = useRef<HTMLDivElement>(null);
    const eventIdRef = useRef(0);

    // Auto-scroll
    useEffect(() => {
        iterationsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [iterations]);

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
            setFinalAnswer(`Error: ${eventData.message || 'Unknown error occurred'}`);
            setIsRunning(false);
            return;
        }
        
        if (event.type === 'iteration') {
            if (eventData.status === 'started') {
                setIterations(prev => [...prev, {
                    number: eventData.number,
                    status: 'started',
                    actions: [],
                }]);
            } else if (eventData.status === 'completed') {
                setIterations(prev => prev.map(iter =>
                    iter.number === eventData.number
                        ? { ...iter, status: 'completed' }
                        : iter
                ));
            }
        } else if (event.type === 'thinking') {
            setIterations(prev => prev.map((iter, idx) =>
                idx === prev.length - 1
                    ? { ...iter, status: 'thinking' }
                    : iter
            ));
        } else if (event.type === 'thought') {
            setIterations(prev => prev.map((iter, idx) =>
                idx === prev.length - 1
                    ? { ...iter, thought: eventData.text, status: 'acting' }
                    : iter
            ));
        } else if (event.type === 'action') {
            if (eventData.stage === 'start') {
                setIterations(prev => prev.map((iter, idx) =>
                    idx === prev.length - 1
                        ? {
                            ...iter,
                            actions: [...iter.actions, { tool: eventData.tool, args: eventData.args }]
                          }
                        : iter
                ));
            } else if (eventData.stage === 'complete') {
                setIterations(prev => prev.map((iter, idx) =>
                    idx === prev.length - 1
                        ? {
                            ...iter,
                            actions: iter.actions.map(action =>
                                action.tool === eventData.tool && !action.result
                                    ? { ...action, result: eventData.result }
                                    : action
                            )
                          }
                        : iter
                ));
            }
        } else if (event.type === 'observation') {
            setIterations(prev => prev.map((iter, idx) =>
                idx === prev.length - 1
                    ? { ...iter, observation: eventData.text, status: 'observing' }
                    : iter
            ));
        } else if (event.type === 'complete') {
            setFinalAnswer(eventData.text);
        }
    }, []);

    const handleComplete = useCallback(() => {
        setIsRunning(false);
        setStreamUrl('');
        
        // If we have iterations with results, consider it successful
        if (iterations.length > 0 && !finalAnswer) {
            const lastIteration = iterations[iterations.length - 1];
            if (lastIteration.actions.some(a => a.result)) {
                // We got results, treat as success even without explicit complete event
                console.log('Stream completed with results');
            }
        }
    }, [iterations, finalAnswer]);

    const handleError = useCallback(() => {
        setIsRunning(false);
        setStreamUrl('');
        
        // Check if we received any events
        if (events.length > 0) {
            setFinalAnswer('Stream interrupted. Partial results shown above.');
        } else {
            setFinalAnswer('Error: Stream failed. Please check console for details and ensure API keys are configured.');
        }
    }, [events.length]);

    const handleStart = () => {
        setIterations([]);
        setFinalAnswer('');
        setEvents([]);
        eventIdRef.current = 0;
        setIsRunning(true);
        const params = new URLSearchParams({ message: input });
        setStreamUrl(`/tutorial/react-loop-detailed?${params.toString()}`);
    };

    const handleStop = () => {
        setIsRunning(false);
        setStreamUrl('');
    };

    const handleClear = () => {
        setIterations([]);
        setFinalAnswer('');
        setEvents([]);
        eventIdRef.current = 0;
    };

    return (
        <>
            <Head title="Tutorial: ReAct Loop" />

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
                                <h1 className="text-3xl font-bold text-foreground">ReAct Loop Demo</h1>
                                <p className="mt-2 text-muted-foreground">
                                    Watch the Reasoning + Acting cycle in real-time
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
                                    Message
                                </label>
                                <div className="flex gap-3">
                                    <input
                                        type="text"
                                        value={input}
                                        onChange={(e) => setInput(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !isRunning) handleStart();
                                        }}
                                        placeholder="What should the agent do?"
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
                                            Start Loop
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

                            {/* Iterations Timeline */}
                            {iterations.length > 0 && (
                                <div className="space-y-4">
                                    {iterations.map((iteration) => (
                                        <IterationCard key={iteration.number} iteration={iteration} />
                                    ))}
                                    <div ref={iterationsEndRef} />
                                </div>
                            )}

                            {/* Final Answer */}
                            {finalAnswer && (
                                <div className="rounded-xl border-2 border-green-500/50 bg-green-50 p-6 shadow-sm dark:bg-green-950/30">
                                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-green-700 dark:text-green-400">
                                        <span>✓</span>
                                        <span>Final Answer</span>
                                    </div>
                                    <div className="whitespace-pre-wrap text-foreground">{finalAnswer}</div>
                                </div>
                            )}

                            {/* Empty State */}
                            {iterations.length === 0 && !isRunning && (
                                <div className="rounded-xl border border-border bg-card p-12 text-center shadow-sm">
                                    <div className="mb-4 text-5xl">🔄</div>
                                    <p className="text-muted-foreground">
                                        Click "Start Loop" to see the ReAct cycle in action
                                    </p>
                                </div>
                            )}
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

// ─── Iteration Card Component ───────────────────────────────────────────────

function IterationCard({ iteration }: { iteration: Iteration }) {
    const [isExpanded, setIsExpanded] = useState(true);

    return (
        <div className="rounded-xl border border-border bg-card shadow-sm">
            {/* Header */}
            <div
                className="flex cursor-pointer items-center justify-between border-b border-border px-6 py-4"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-3">
                    <div className={`h-3 w-3 rounded-full ${
                        iteration.status === 'completed' ? 'bg-green-500' :
                        iteration.status === 'started' ? 'bg-blue-500' :
                        'animate-pulse bg-yellow-500'
                    }`} />
                    <h3 className="font-semibold text-foreground">
                        Iteration {iteration.number}
                    </h3>
                    <span className="rounded bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                        {iteration.status}
                    </span>
                </div>
                <button className="text-muted-foreground hover:text-foreground">
                    {isExpanded ? '▼' : '▶'}
                </button>
            </div>

            {/* Content */}
            {isExpanded && (
                <div className="space-y-4 p-6">
                    {/* Thought */}
                    {iteration.thought && (
                        <div>
                            <div className="mb-2 text-sm font-semibold text-yellow-700 dark:text-yellow-400">
                                💭 Thought
                            </div>
                            <div className="rounded-lg bg-yellow-50 p-3 text-sm text-foreground dark:bg-yellow-950/30">
                                {iteration.thought}
                            </div>
                        </div>
                    )}

                    {/* Actions */}
                    {iteration.actions.length > 0 && (
                        <div>
                            <div className="mb-2 text-sm font-semibold text-blue-700 dark:text-blue-400">
                                🔧 Actions ({iteration.actions.length})
                            </div>
                            <div className="space-y-2">
                                {iteration.actions.map((action, idx) => (
                                    <div key={idx} className="rounded-lg bg-blue-50 p-3 dark:bg-blue-950/30">
                                        <div className="mb-1 font-mono text-sm font-semibold text-foreground">
                                            {action.tool}
                                        </div>
                                        <div className="mb-2 text-xs text-muted-foreground">
                                            {JSON.stringify(action.args)}
                                        </div>
                                        {action.result && (
                                            <div className="mt-2 border-t border-blue-200 pt-2 text-sm text-foreground dark:border-blue-800">
                                                → {action.result}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Observation */}
                    {iteration.observation && (
                        <div>
                            <div className="mb-2 text-sm font-semibold text-purple-700 dark:text-purple-400">
                                👁️ Observation
                            </div>
                            <div className="rounded-lg bg-purple-50 p-3 text-sm text-foreground dark:bg-purple-950/30">
                                {iteration.observation}
                            </div>
                        </div>
                    )}
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
        eventName: ['iteration', 'thinking', 'thought', 'action', 'observation', 'complete', 'max_iterations', 'error'],
        onMessage: onEvent,
        onComplete,
        onError: handleError,
    });

    return null;
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function getEventColor(type: string): string {
    const colors: Record<string, string> = {
        iteration: 'bg-gray-100 text-gray-800 dark:bg-gray-800/40 dark:text-gray-300',
        thinking: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
        thought: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
        action: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
        observation: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
        complete: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
        max_iterations: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    };
    return colors[type] || 'bg-gray-100 text-gray-800 dark:bg-gray-800/40 dark:text-gray-300';
}
