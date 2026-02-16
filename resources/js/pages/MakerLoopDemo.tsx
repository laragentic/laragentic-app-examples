import { Head } from '@inertiajs/react';
import { useEventStream } from '@laravel/stream-react';
import { useState, useCallback, useRef, useEffect } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────

type MakerStep = {
    iteration: number;
    type: 'decompose' | 'execute' | 'compose' | 'vote' | 'consensus' | 'red_flag';
    data: any;
    timestamp: string;
};

type ExecutionStats = {
    total_steps: number;
    atomic_executions: number;
    decompositions: number;
    compositions: number;
    subtasks_created: number;
    votes_cast: number;
    red_flags_detected: number;
    max_depth_reached: number;
};

type Event = {
    id: number;
    timestamp: string;
    type: string;
    data: any;
};

// ─── Main Component ─────────────────────────────────────────────────────────

export default function MakerLoopDemo() {
    const [input, setInput] = useState('Calculate 5! step by step');
    const [streamUrl, setStreamUrl] = useState('');
    const [isRunning, setIsRunning] = useState(false);
    const [steps, setSteps] = useState<MakerStep[]>([]);
    const [finalResult, setFinalResult] = useState('');
    const [stats, setStats] = useState<ExecutionStats | null>(null);
    const [errorRate, setErrorRate] = useState<number | null>(null);
    const [events, setEvents] = useState<Event[]>([]);
    const [showEvents, setShowEvents] = useState(false);
    const [votingK, setVotingK] = useState(2);
    const [maxDepth, setMaxDepth] = useState(2);
    const [redFlagging, setRedFlagging] = useState(true);
    const contentEndRef = useRef<HTMLDivElement>(null);
    const eventsEndRef = useRef<HTMLDivElement>(null);
    const eventIdRef = useRef(0);

    // Auto-scroll
    useEffect(() => {
        contentEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [steps, finalResult]);

    useEffect(() => {
        if (showEvents) {
            eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [events, showEvents]);

    const handleEvent = useCallback((event: MessageEvent) => {
        const eventData =
            typeof event.data === 'string'
                ? JSON.parse(event.data)
                : event.data;

        // Add to event log
        setEvents((prev) => [
            ...prev,
            {
                id: eventIdRef.current++,
                timestamp: new Date().toLocaleTimeString('en-US', {
                    hour12: false,
                    fractionalSecondDigits: 3,
                }),
                type: event.type || 'update',
                data: eventData,
            },
        ]);

        // Handle different event types
        if (event.type === 'error') {
            setFinalResult(
                `Error: ${eventData.message || 'Unknown error occurred'}`,
            );
            setIsRunning(false);
            return;
        }

        if (event.type === 'start') {
            setSteps([]);
            setFinalResult('');
            setStats(null);
            setErrorRate(null);
        } else if (event.type === 'decomposition') {
            setSteps((prev) => [
                ...prev,
                {
                    iteration: eventData.iteration,
                    type: 'decompose',
                    data: eventData,
                    timestamp: new Date().toLocaleTimeString(),
                },
            ]);
        } else if (event.type === 'vote') {
            if (eventData.stage === 'after') {
                setSteps((prev) => [
                    ...prev,
                    {
                        iteration: eventData.iteration,
                        type: 'vote',
                        data: eventData,
                        timestamp: new Date().toLocaleTimeString(),
                    },
                ]);
            }
        } else if (event.type === 'consensus') {
            setSteps((prev) => [
                ...prev,
                {
                    iteration: eventData.iteration,
                    type: 'consensus',
                    data: eventData,
                    timestamp: new Date().toLocaleTimeString(),
                },
            ]);
        } else if (event.type === 'red_flag') {
            setSteps((prev) => [
                ...prev,
                {
                    iteration: eventData.iteration,
                    type: 'red_flag',
                    data: eventData,
                    timestamp: new Date().toLocaleTimeString(),
                },
            ]);
        } else if (event.type === 'atomic_execution') {
            setSteps((prev) => [
                ...prev,
                {
                    iteration: eventData.iteration,
                    type: 'execute',
                    data: eventData,
                    timestamp: new Date().toLocaleTimeString(),
                },
            ]);
        } else if (event.type === 'composition') {
            setSteps((prev) => [
                ...prev,
                {
                    iteration: eventData.iteration,
                    type: 'compose',
                    data: eventData,
                    timestamp: new Date().toLocaleTimeString(),
                },
            ]);
        } else if (event.type === 'final_result' || event.type === 'result') {
            setFinalResult(eventData.text);
            setStats(eventData.stats);
            setErrorRate(eventData.error_rate);
            setIsRunning(false);
        } else if (event.type === 'complete') {
            setFinalResult(eventData.text);
            setIsRunning(false);
        }
    }, []);

    useEventStream({
        streamUrl,
        events: {
            '*': handleEvent,
        },
    });

    const handleSubmit = (e: React.FormEvent, mode: 'basic' | 'detailed' = 'detailed') => {
        e.preventDefault();
        if (!input.trim() || isRunning) return;

        setIsRunning(true);
        setSteps([]);
        setFinalResult('');
        setStats(null);
        setErrorRate(null);
        setEvents([]);
        eventIdRef.current = 0;

        const url = mode === 'basic' 
            ? '/tutorial/maker-loop-basic'
            : '/tutorial/maker-loop-detailed';

        const body = mode === 'basic'
            ? { message: input }
            : { 
                message: input,
                voting_k: votingK,
                max_depth: maxDepth,
                red_flagging: redFlagging,
            };

        setStreamUrl(url);

        fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'text/event-stream',
            },
            body: JSON.stringify(body),
        }).catch((error) => {
            console.error('Error:', error);
            setIsRunning(false);
            setFinalResult(`Error: ${error.message}`);
        });
    };

    const examplePrompts = [
        'Calculate 5! step by step',
        'Calculate (5! + 3!) × 2',
        'What is 6 factorial?',
        'Calculate 4! + 2!',
    ];

    return (
        <>
            <Head title="MAKER Loop Demo - Laragentic" />

            <div className="container mx-auto px-4 py-8">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-4xl font-bold mb-2">
                        MAKER Loop Demo
                    </h1>
                    <p className="text-muted-foreground">
                        Massively Decomposed Agentic Processes with
                        first-to-ahead-by-K Error correction and
                        Red-flagging
                    </p>
                    <p className="text-sm text-purple-600 dark:text-purple-400 mt-2">
                        Achieves near-zero error rates through extreme
                        decomposition, multi-agent voting, and uncertainty
                        detection
                    </p>
                </div>

                {/* Configuration Panel */}
                <div className="mb-6 p-4 bg-muted/50 rounded-lg border">
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                        ⚙️ Configuration
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm font-medium mb-1">
                                Voting K (consensus threshold)
                            </label>
                            <select
                                value={votingK}
                                onChange={(e) =>
                                    setVotingK(Number(e.target.value))
                                }
                                className="w-full px-3 py-2 bg-background border rounded"
                                disabled={isRunning}
                            >
                                <option value="2">K=2 (Fast, moderate reliability)</option>
                                <option value="3">K=3 (Balanced, recommended)</option>
                                <option value="4">K=4 (Very reliable but slow)</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">
                                Max Decomposition Depth
                            </label>
                            <input
                                type="number"
                                value={maxDepth}
                                onChange={(e) =>
                                    setMaxDepth(Number(e.target.value))
                                }
                                min="1"
                                max="10"
                                className="w-full px-3 py-2 bg-background border rounded"
                                disabled={isRunning}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">
                                Red-Flagging (uncertainty detection)
                            </label>
                            <label className="flex items-center gap-2 mt-2">
                                <input
                                    type="checkbox"
                                    checked={redFlagging}
                                    onChange={(e) =>
                                        setRedFlagging(e.target.checked)
                                    }
                                    className="w-4 h-4"
                                    disabled={isRunning}
                                />
                                <span className="text-sm">Enable</span>
                            </label>
                        </div>
                    </div>
                </div>

                {/* Input Form */}
                <form
                    onSubmit={(e) => handleSubmit(e, 'detailed')}
                    className="mb-6"
                >
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Enter a calculation task..."
                            className="flex-1 px-4 py-3 bg-background border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                            disabled={isRunning}
                        />
                        <button
                            type="submit"
                            disabled={isRunning || !input.trim()}
                            className="px-6 py-3 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-semibold transition-colors"
                        >
                            {isRunning ? 'Running...' : 'Execute'}
                        </button>
                    </div>

                    {/* Example Prompts */}
                    <div className="mt-3 flex flex-wrap gap-2">
                        <span className="text-sm text-muted-foreground">Try:</span>
                        {examplePrompts.map((prompt, i) => (
                            <button
                                key={i}
                                type="button"
                                onClick={() => setInput(prompt)}
                                className="text-sm px-3 py-1 bg-muted hover:bg-muted/80 rounded-full transition-colors"
                                disabled={isRunning}
                            >
                                {prompt}
                            </button>
                        ))}
                    </div>
                </form>

                {/* Main Content Area */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Execution Steps */}
                    <div className="bg-card rounded-lg border p-6">
                        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                            🔄 Execution Steps
                            {isRunning && (
                                <span className="text-sm text-primary animate-pulse">
                                    Processing...
                                </span>
                            )}
                        </h2>

                        <div className="space-y-3 max-h-[500px] overflow-y-auto">
                            {steps.length === 0 && !isRunning && (
                                <p className="text-muted-foreground text-center py-8">
                                    No execution steps yet. Enter a task and
                                    click Execute.
                                </p>
                            )}

                            {steps.map((step, idx) => (
                                <div
                                    key={idx}
                                    className={`p-3 rounded border ${
                                        step.type === 'decompose'
                                            ? 'bg-blue-50 dark:bg-blue-950/20 border-blue-300 dark:border-blue-700'
                                            : step.type === 'execute'
                                              ? 'bg-green-50 dark:bg-green-950/20 border-green-300 dark:border-green-700'
                                              : step.type === 'compose'
                                                ? 'bg-purple-50 dark:bg-purple-950/20 border-purple-300 dark:border-purple-700'
                                                : step.type === 'vote'
                                                  ? 'bg-yellow-50 dark:bg-yellow-950/20 border-yellow-300 dark:border-yellow-700'
                                                  : step.type === 'consensus'
                                                    ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-700'
                                                    : 'bg-red-50 dark:bg-red-950/20 border-red-300 dark:border-red-700'
                                    }`}
                                >
                                    <div className="flex items-start gap-2">
                                        <span className="text-xs px-2 py-1 rounded bg-muted">
                                            {step.timestamp}
                                        </span>
                                        <div className="flex-1">
                                            {step.type === 'decompose' && (
                                                <div>
                                                    <div className="font-semibold text-blue-600 dark:text-blue-400">
                                                        📦 Decomposition (depth: {step.data.depth})
                                                    </div>
                                                    <div className="text-sm mt-1">
                                                        {step.data.count} subtasks created
                                                    </div>
                                                </div>
                                            )}
                                            {step.type === 'execute' && (
                                                <div>
                                                    <div className="font-semibold text-green-600 dark:text-green-400">
                                                        ⚡ Atomic Execution
                                                    </div>
                                                    <div className="text-sm mt-1">
                                                        Result: {step.data.result}
                                                    </div>
                                                </div>
                                            )}
                                            {step.type === 'compose' && (
                                                <div>
                                                    <div className="font-semibold text-purple-600 dark:text-purple-400">
                                                        🔨 Composition
                                                    </div>
                                                    <div className="text-sm mt-1">
                                                        Combining results
                                                    </div>
                                                </div>
                                            )}
                                            {step.type === 'vote' && (
                                                <div>
                                                    <div className="font-semibold text-yellow-600 dark:text-yellow-400">
                                                        🗳️ Vote #{step.data.vote_number}
                                                    </div>
                                                </div>
                                            )}
                                            {step.type === 'consensus' && (
                                                <div>
                                                    <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                                                        ✅ Consensus ({step.data.votes} votes)
                                                    </div>
                                                </div>
                                            )}
                                            {step.type === 'red_flag' && (
                                                <div>
                                                    <div className="font-semibold text-red-600 dark:text-red-400">
                                                        🚩 Red Flag Detected (score: {step.data.score.toFixed(2)})
                                                    </div>
                                                    <div className="text-sm mt-1">
                                                        Retrying...
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}

                                <div ref={contentEndRef} />
                            </div>
                        </div>

                    {/* Results & Stats */}
                    <div className="space-y-6">
                        {/* Final Result */}
                        <div className="bg-card rounded-lg border p-6">
                            <h2 className="text-xl font-bold mb-4">
                                📝 Final Result
                            </h2>
                            {finalResult ? (
                                <div className="prose prose-sm max-w-none dark:prose-invert">
                                    <p className="text-lg">{finalResult}</p>
                                </div>
                            ) : (
                                <p className="text-muted-foreground text-center py-4">
                                    Waiting for result...
                                </p>
                            )}
                        </div>

                        {/* Execution Statistics */}
                        {stats && (
                            <div className="bg-card rounded-lg border p-6">
                                <h2 className="text-xl font-bold mb-4">
                                    📊 Execution Statistics
                                </h2>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-3 bg-muted/50 rounded">
                                        <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                                            {stats.total_steps}
                                        </div>
                                        <div className="text-sm">
                                            Total Steps
                                        </div>
                                    </div>
                                    <div className="p-3 bg-muted/50 rounded">
                                        <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                                            {stats.votes_cast}
                                        </div>
                                        <div className="text-sm">
                                            Votes Cast
                                        </div>
                                    </div>
                                    <div className="p-3 bg-muted/50 rounded">
                                        <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                                            {stats.decompositions}
                                        </div>
                                        <div className="text-sm">
                                            Decompositions
                                        </div>
                                    </div>
                                    <div className="p-3 bg-muted/50 rounded">
                                        <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                                            {stats.atomic_executions}
                                        </div>
                                        <div className="text-sm">
                                            Atomic Executions
                                        </div>
                                    </div>
                                    <div className="p-3 bg-muted/50 rounded">
                                        <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                                            {stats.red_flags_detected}
                                        </div>
                                        <div className="text-sm">
                                            Red Flags
                                        </div>
                                    </div>
                                    <div className="p-3 bg-muted/50 rounded">
                                        <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                                            {errorRate !== null
                                                ? (errorRate * 100).toFixed(1) + '%'
                                                : 'N/A'}
                                        </div>
                                        <div className="text-sm">
                                            Error Rate
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Event Log (Collapsible) */}
                <div className="mt-6 bg-card rounded-lg border">
                    <button
                        onClick={() => setShowEvents(!showEvents)}
                        className="w-full px-6 py-4 text-left font-semibold flex items-center justify-between hover:bg-muted/50 transition-colors"
                    >
                        <span>📋 Raw Event Log ({events.length})</span>
                        <span className="text-2xl">
                            {showEvents ? '−' : '+'}
                        </span>
                    </button>

                    {showEvents && (
                        <div className="p-6 pt-0">
                            <div className="bg-muted rounded p-4 max-h-64 overflow-y-auto font-mono text-xs">
                                {events.length === 0 ? (
                                    <p className="text-muted-foreground">
                                        No events yet
                                    </p>
                                ) : (
                                    events.map((event) => (
                                        <div
                                            key={event.id}
                                            className="mb-2 pb-2 border-b last:border-0"
                                        >
                                            <div className="text-muted-foreground">
                                                [{event.timestamp}]
                                                <span className="ml-2 text-primary">
                                                    {event.type}
                                                </span>
                                            </div>
                                            <div className="mt-1">
                                                {JSON.stringify(
                                                    event.data,
                                                    null,
                                                    2,
                                                )}
                                            </div>
                                        </div>
                                    ))
                                )}
                                <div ref={eventsEndRef} />
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
