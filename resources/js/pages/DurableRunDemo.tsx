import { Head } from '@inertiajs/react';
import { useEventStream } from '@laravel/stream-react';
import { useState, useCallback, useRef, useEffect } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────

type RunStatus = 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';

type Checkpoint = {
    type: string;
    sequence: number;
    iteration: number;
    tool?: string;
    idempotency_key?: string;
    saved: boolean;
    timestamp: string;
};

type Iteration = {
    number: number;
    status: 'started' | 'thinking' | 'acting' | 'observing' | 'completed';
    thought?: string;
    actions: Array<{ tool: string; args: any; result?: string }>;
    observation?: string;
};

type PastRun = {
    id: string;
    status: RunStatus;
    loop_type: string;
    input: { task: string };
    current_iteration: number;
    idempotency_key: string | null;
    checkpoint_count: number;
    created_at: string;
    completed_at: string | null;
    cancelled_at: string | null;
    error: string | null;
};

// ─── Main Component ─────────────────────────────────────────────────────────

export default function DurableRunDemo() {
    // ── Form state ────────────────────────────────────────────────────────
    const [task, setTask] = useState(
        'Search for the Laravel AI SDK, get the weather in Tokyo, then calculate the sum of 42 and 58',
    );
    const [idempotencyKey, setIdempotencyKey] = useState('');
    const [showAdvanced, setShowAdvanced] = useState(false);

    // ── Current run state ─────────────────────────────────────────────────
    const [runId, setRunId] = useState<string | null>(null);
    const [runStatus, setRunStatus] = useState<RunStatus>('pending');
    const [streamUrl, setStreamUrl] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
    const [iterations, setIterations] = useState<Iteration[]>([]);
    const [finalAnswer, setFinalAnswer] = useState('');
    const [startedAt, setStartedAt] = useState<Date | null>(null);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [activeTab, setActiveTab] = useState<'progress' | 'checkpoints'>('progress');
    const [copiedRunId, setCopiedRunId] = useState(false);
    const [existingRunReused, setExistingRunReused] = useState(false);

    // ── Past runs state ───────────────────────────────────────────────────
    const [pastRuns, setPastRuns] = useState<PastRun[]>([]);
    const [loadingPastRuns, setLoadingPastRuns] = useState(false);
    const [showPastRuns, setShowPastRuns] = useState(false);

    const progressEndRef = useRef<HTMLDivElement>(null);
    const checkpointEndRef = useRef<HTMLDivElement>(null);

    // ── Elapsed timer ─────────────────────────────────────────────────────
    useEffect(() => {
        if (!isStreaming || !startedAt) return;
        const interval = setInterval(() => {
            setElapsedSeconds(Math.floor((Date.now() - startedAt.getTime()) / 1000));
        }, 1000);
        return () => clearInterval(interval);
    }, [isStreaming, startedAt]);

    // ── Auto-scroll ───────────────────────────────────────────────────────
    useEffect(() => {
        if (activeTab === 'progress') {
            progressEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [iterations, activeTab]);

    useEffect(() => {
        if (activeTab === 'checkpoints') {
            checkpointEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [checkpoints, activeTab]);

    // ── SSE event handler ─────────────────────────────────────────────────
    const handleEvent = useCallback((event: MessageEvent) => {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;

        if (event.type === 'checkpoint') {
            setCheckpoints(prev => [...prev, {
                type:            data.type,
                sequence:        data.sequence,
                iteration:       data.iteration,
                tool:            data.tool,
                idempotency_key: data.idempotency_key,
                saved:           data.saved,
                timestamp:       new Date().toLocaleTimeString('en-US', { hour12: false, fractionalSecondDigits: 3 }),
            }]);
            return;
        }

        if (event.type === 'iteration') {
            if (data.status === 'started') {
                setIterations(prev => [...prev, {
                    number: data.number,
                    status: 'started',
                    actions: [],
                }]);
            }
            return;
        }

        if (event.type === 'thought') {
            setIterations(prev => prev.map((iter, idx) =>
                idx === prev.length - 1
                    ? { ...iter, thought: data.text, status: 'acting' as const }
                    : iter
            ));
            return;
        }

        if (event.type === 'action') {
            if (data.stage === 'start') {
                setIterations(prev => prev.map((iter, idx) =>
                    idx === prev.length - 1
                        ? { ...iter, status: 'acting' as const, actions: [...iter.actions, { tool: data.tool, args: data.args }] }
                        : iter
                ));
            } else if (data.stage === 'complete') {
                setIterations(prev => prev.map((iter, idx) =>
                    idx === prev.length - 1
                        ? {
                            ...iter,
                            actions: iter.actions.map(a =>
                                a.tool === data.tool && !a.result ? { ...a, result: data.result } : a
                            ),
                          }
                        : iter
                ));
            }
            return;
        }

        if (event.type === 'observation') {
            setIterations(prev => prev.map((iter, idx) =>
                idx === prev.length - 1
                    ? { ...iter, observation: data.text, status: 'observing' as const }
                    : iter
            ));
            return;
        }

        if (event.type === 'complete') {
            setRunStatus('completed');
            setFinalAnswer(data.text);
            setIsStreaming(false);
            setStreamUrl('');
            return;
        }

        if (event.type === 'cancelled') {
            setRunStatus('cancelled');
            setFinalAnswer('Run was cancelled.');
            setIsStreaming(false);
            setStreamUrl('');
            return;
        }

        if (event.type === 'timed_out') {
            setRunStatus('failed');
            setFinalAnswer('Run exceeded its timeout and was stopped.');
            setIsStreaming(false);
            setStreamUrl('');
            return;
        }

        if (event.type === 'max_iterations') {
            setRunStatus('failed');
            setFinalAnswer(`Max iterations reached. Partial result: ${data.text}`);
            setIsStreaming(false);
            setStreamUrl('');
            return;
        }

        if (event.type === 'error') {
            setRunStatus('failed');
            setFinalAnswer(`Error: ${data.message}`);
            setIsStreaming(false);
            setStreamUrl('');
        }
    }, []);

    const handleStreamComplete = useCallback(() => {
        setIsStreaming(false);
        setStreamUrl('');
        if (runStatus === 'running') {
            setRunStatus('completed');
        }
    }, [runStatus]);

    const handleStreamError = useCallback((error?: any) => {
        // Filter known @laravel/stream-react closure bug
        if (error?.message?.includes('startsWith') || error?.type === 'error') {
            handleStreamComplete();
        } else {
            setIsStreaming(false);
            setStreamUrl('');
            if (runStatus === 'running') {
                setRunStatus('failed');
            }
        }
    }, [handleStreamComplete, runStatus]);

    // ── Start a new run ───────────────────────────────────────────────────
    const handleStart = async () => {
        if (!task.trim()) return;

        // Reset state
        setCheckpoints([]);
        setIterations([]);
        setFinalAnswer('');
        setRunId(null);
        setElapsedSeconds(0);
        setExistingRunReused(false);

        try {
            const csrf = (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content ?? '';

            const res = await fetch('/tutorial/durable-run-start', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
                body:    JSON.stringify({
                    task,
                    idempotency_key:  idempotencyKey.trim() || undefined,
                    timeout_minutes:  5,
                }),
            });

            const json = await res.json();
            if (!res.ok) {
                setFinalAnswer(`Error starting run: ${json.error}`);
                return;
            }

            setRunId(json.run_id);
            setRunStatus('running');
            setIsStreaming(true);
            setStartedAt(new Date());
            setExistingRunReused(json.existing === true);
            setStreamUrl(`/tutorial/durable-run-stream?run_id=${json.run_id}`);
        } catch (err: any) {
            setFinalAnswer(`Network error: ${err.message}`);
        }
    };

    // ── Cancel the active run ─────────────────────────────────────────────
    const handleCancel = async () => {
        if (!runId) return;

        const csrf = (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content ?? '';
        await fetch(`/tutorial/durable-run-cancel/${runId}`, {
            method:  'POST',
            headers: { 'X-CSRF-Token': csrf },
        });
        // The SSE stream will detect the cancel at the next iteration boundary
        // and emit a 'cancelled' event that updates our state.
    };

    // ── Resume a past run ─────────────────────────────────────────────────
    const handleResume = async (previousRunId: string) => {
        setCheckpoints([]);
        setIterations([]);
        setFinalAnswer('');
        setRunId(null);
        setElapsedSeconds(0);
        setExistingRunReused(false);

        try {
            const csrf = (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content ?? '';

            const res = await fetch(`/tutorial/durable-run-resume/${previousRunId}`, {
                method:  'POST',
                headers: { 'X-CSRF-Token': csrf },
            });

            const json = await res.json();
            if (!res.ok) {
                setFinalAnswer(`Resume error: ${json.error}`);
                return;
            }

            setRunId(json.run_id);
            setRunStatus('running');
            setIsStreaming(true);
            setStartedAt(new Date());
            setStreamUrl(`/tutorial/durable-run-stream?run_id=${json.run_id}`);
            setShowPastRuns(false);
        } catch (err: any) {
            setFinalAnswer(`Network error: ${err.message}`);
        }
    };

    // ── Load past runs ────────────────────────────────────────────────────
    const loadPastRuns = async () => {
        setLoadingPastRuns(true);
        try {
            const res = await fetch('/tutorial/durable-runs-list');
            const json = await res.json();
            setPastRuns(Array.isArray(json) ? json : []);
        } catch {
            setPastRuns([]);
        } finally {
            setLoadingPastRuns(false);
        }
    };

    const handleTogglePastRuns = () => {
        const next = !showPastRuns;
        setShowPastRuns(next);
        if (next) loadPastRuns();
    };

    // ── Copy run ID ───────────────────────────────────────────────────────
    const handleCopyRunId = () => {
        if (!runId) return;
        navigator.clipboard.writeText(runId).then(() => {
            setCopiedRunId(true);
            setTimeout(() => setCopiedRunId(false), 2000);
        });
    };

    // ── Format elapsed time ───────────────────────────────────────────────
    const formatElapsed = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${String(s).padStart(2, '0')}`;
    };

    const hasRun = runId !== null;

    return (
        <>
            <Head title="Tutorial: Durable Runs" />

            {streamUrl && (
                <StreamListener
                    url={streamUrl}
                    onEvent={handleEvent}
                    onComplete={handleStreamComplete}
                    onError={handleStreamError}
                />
            )}

            <div className="min-h-screen bg-background p-6">
                <div className="mx-auto max-w-5xl space-y-6">

                    {/* ── Header ── */}
                    <div>
                        <h1 className="text-3xl font-bold text-foreground">Durable Runs Demo</h1>
                        <p className="mt-2 text-muted-foreground">
                            Run IDs, database checkpoints, cancellation, idempotency keys, and resume after interruption
                        </p>
                    </div>

                    {/* ── Feature overview ── */}
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {[
                            { icon: '🔖', label: 'Run IDs', desc: 'Stable UUID per execution' },
                            { icon: '💾', label: 'Checkpoints', desc: 'Every event saved to DB' },
                            { icon: '✕', label: 'Cancellation', desc: 'Cancel any active run' },
                            { icon: '↩', label: 'Resume', desc: 'Continue with full history' },
                        ].map(f => (
                            <div key={f.label} className="rounded-lg border border-border bg-card p-3 text-center shadow-sm">
                                <div className="text-xl">{f.icon}</div>
                                <div className="mt-1 text-sm font-semibold text-foreground">{f.label}</div>
                                <div className="text-xs text-muted-foreground">{f.desc}</div>
                            </div>
                        ))}
                    </div>

                    {/* ── Input form ── */}
                    <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
                        <div className="space-y-4">
                            <div>
                                <label className="mb-2 block text-sm font-medium text-foreground">
                                    Task
                                </label>
                                <textarea
                                    value={task}
                                    onChange={e => setTask(e.target.value)}
                                    disabled={isStreaming}
                                    rows={2}
                                    placeholder="What should the agent do?"
                                    className="w-full rounded-lg border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                                />
                            </div>

                            {/* Advanced: idempotency key */}
                            <div>
                                <button
                                    onClick={() => setShowAdvanced(!showAdvanced)}
                                    className="text-xs text-muted-foreground underline hover:text-foreground"
                                >
                                    {showAdvanced ? 'Hide' : 'Show'} advanced options
                                </button>
                                {showAdvanced && (
                                    <div className="mt-3">
                                        <label className="mb-1 block text-sm font-medium text-foreground">
                                            Idempotency Key{' '}
                                            <span className="font-normal text-muted-foreground">
                                                (optional – prevents duplicate runs on retry)
                                            </span>
                                        </label>
                                        <input
                                            type="text"
                                            value={idempotencyKey}
                                            onChange={e => setIdempotencyKey(e.target.value)}
                                            disabled={isStreaming}
                                            placeholder="my-unique-run-key"
                                            className="w-full rounded-lg border border-input bg-background px-4 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                                        />
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            If a run already exists with this key, the server returns
                                            the existing run rather than creating a new one — safe to retry.
                                        </p>
                                    </div>
                                )}
                            </div>

                            <div className="flex gap-3">
                                {!isStreaming ? (
                                    <button
                                        onClick={handleStart}
                                        disabled={!task.trim()}
                                        className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                                    >
                                        Start Durable Run
                                    </button>
                                ) : (
                                    <button
                                        onClick={handleCancel}
                                        className="rounded-lg bg-destructive/10 px-6 py-2.5 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/20"
                                    >
                                        Cancel Run
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* ── Active run ── */}
                    {hasRun && (
                        <div className="rounded-xl border border-border bg-card shadow-sm">
                            {/* Run header */}
                            <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-4">
                                {/* Run ID */}
                                <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-1.5 dark:bg-amber-950/40">
                                    <span className="text-xs font-medium text-amber-700 dark:text-amber-400">Run ID</span>
                                    <code className="font-mono text-xs font-bold text-amber-900 dark:text-amber-200">
                                        {runId?.slice(0, 8)}…{runId?.slice(-8)}
                                    </code>
                                    <button
                                        onClick={handleCopyRunId}
                                        className="text-xs text-amber-600 transition-colors hover:text-amber-900 dark:text-amber-400"
                                        title="Copy full Run ID"
                                    >
                                        {copiedRunId ? '✓ Copied' : 'Copy'}
                                    </button>
                                </div>

                                {/* Status */}
                                <StatusBadge status={runStatus} />

                                {/* Timer */}
                                {isStreaming && (
                                    <span className="text-sm text-muted-foreground">
                                        {formatElapsed(elapsedSeconds)}
                                    </span>
                                )}

                                {/* Existing run notice */}
                                {existingRunReused && (
                                    <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                                        Existing run returned (idempotency key matched)
                                    </span>
                                )}

                                {/* Checkpoint count */}
                                <span className="ml-auto text-sm text-muted-foreground">
                                    {checkpoints.length} checkpoint{checkpoints.length !== 1 ? 's' : ''} saved
                                </span>
                            </div>

                            {/* Tabs */}
                            <div className="flex border-b border-border">
                                {(['progress', 'checkpoints'] as const).map(tab => (
                                    <button
                                        key={tab}
                                        onClick={() => setActiveTab(tab)}
                                        className={`px-6 py-3 text-sm font-medium transition-colors ${
                                            activeTab === tab
                                                ? 'border-b-2 border-primary text-foreground'
                                                : 'text-muted-foreground hover:text-foreground'
                                        }`}
                                    >
                                        {tab === 'progress' ? 'Progress' : `Checkpoints (${checkpoints.length})`}
                                    </button>
                                ))}
                            </div>

                            {/* Tab: Progress */}
                            {activeTab === 'progress' && (
                                <div className="space-y-4 p-6">
                                    {iterations.length === 0 && isStreaming && (
                                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                            <span className="animate-pulse">●</span> Starting run…
                                        </div>
                                    )}
                                    {iterations.map(iter => (
                                        <IterationCard key={iter.number} iteration={iter} />
                                    ))}
                                    <div ref={progressEndRef} />
                                </div>
                            )}

                            {/* Tab: Checkpoints */}
                            {activeTab === 'checkpoints' && (
                                <div className="p-6">
                                    {checkpoints.length === 0 ? (
                                        <p className="text-center text-sm text-muted-foreground">
                                            {isStreaming ? 'Waiting for first checkpoint…' : 'No checkpoints recorded.'}
                                        </p>
                                    ) : (
                                        <div className="space-y-2">
                                            {checkpoints.map((cp, idx) => (
                                                <CheckpointRow key={idx} checkpoint={cp} />
                                            ))}
                                            <div ref={checkpointEndRef} />
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── Final result ── */}
                    {finalAnswer && (
                        <div className={`rounded-xl border-2 p-6 shadow-sm ${
                            runStatus === 'completed'
                                ? 'border-green-500/50 bg-green-50 dark:bg-green-950/30'
                                : runStatus === 'cancelled'
                                ? 'border-orange-500/50 bg-orange-50 dark:bg-orange-950/30'
                                : 'border-red-500/50 bg-red-50 dark:bg-red-950/30'
                        }`}>
                            <div className={`mb-2 flex items-center gap-2 text-sm font-semibold ${
                                runStatus === 'completed'
                                    ? 'text-green-700 dark:text-green-400'
                                    : runStatus === 'cancelled'
                                    ? 'text-orange-700 dark:text-orange-400'
                                    : 'text-red-700 dark:text-red-400'
                            }`}>
                                <span>{runStatus === 'completed' ? '✓' : runStatus === 'cancelled' ? '✕' : '!'}</span>
                                <span>
                                    {runStatus === 'completed'
                                        ? 'Run Completed'
                                        : runStatus === 'cancelled'
                                        ? 'Run Cancelled'
                                        : 'Run Failed'}
                                </span>
                            </div>
                            <div className="whitespace-pre-wrap text-foreground">{finalAnswer}</div>
                            {/* Resume option for non-completed runs */}
                            {runId && runStatus !== 'completed' && (
                                <div className="mt-4 border-t border-border pt-4">
                                    <p className="mb-2 text-xs text-muted-foreground">
                                        This run was interrupted.{' '}
                                        {checkpoints.some(cp => cp.type === 'complete') === false &&
                                            'All checkpoints up to the interruption point are saved. '}
                                        Resume will start a new run that inherits the conversation history.
                                    </p>
                                    <button
                                        onClick={() => handleResume(runId)}
                                        className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                                    >
                                        Resume Run
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── Past runs ── */}
                    <div className="rounded-xl border border-border bg-card shadow-sm">
                        <div className="flex items-center justify-between border-b border-border px-6 py-4">
                            <h2 className="font-semibold text-foreground">Past Runs</h2>
                            <button
                                onClick={handleTogglePastRuns}
                                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                            >
                                {showPastRuns ? 'Hide' : 'Load'}
                            </button>
                        </div>

                        {showPastRuns && (
                            <div className="p-4">
                                {loadingPastRuns ? (
                                    <p className="text-center text-sm text-muted-foreground">Loading…</p>
                                ) : pastRuns.length === 0 ? (
                                    <p className="text-center text-sm text-muted-foreground">No past runs found.</p>
                                ) : (
                                    <div className="space-y-2">
                                        {pastRuns.map(run => (
                                            <PastRunRow key={run.id} run={run} onResume={handleResume} />
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                </div>
            </div>
        </>
    );
}

// ─── Iteration Card ──────────────────────────────────────────────────────────

function IterationCard({ iteration }: { iteration: Iteration }) {
    const [expanded, setExpanded] = useState(true);

    return (
        <div className="rounded-xl border border-border bg-background shadow-sm">
            <div
                className="flex cursor-pointer items-center justify-between border-b border-border px-5 py-3"
                onClick={() => setExpanded(!expanded)}
            >
                <div className="flex items-center gap-3">
                    <span className={`h-2.5 w-2.5 rounded-full ${
                        iteration.status === 'completed' ? 'bg-green-500' :
                        iteration.status === 'started'   ? 'bg-blue-500' :
                        'animate-pulse bg-yellow-500'
                    }`} />
                    <span className="font-semibold text-foreground">Iteration {iteration.number}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{iteration.status}</span>
                </div>
                <span className="text-muted-foreground">{expanded ? '▼' : '▶'}</span>
            </div>

            {expanded && (
                <div className="space-y-3 p-5">
                    {iteration.thought && (
                        <div>
                            <div className="mb-1 text-xs font-semibold text-yellow-700 dark:text-yellow-400">Thought</div>
                            <div className="rounded-lg bg-yellow-50 p-3 text-sm text-foreground dark:bg-yellow-950/30">
                                {iteration.thought}
                            </div>
                        </div>
                    )}
                    {iteration.actions.length > 0 && (
                        <div>
                            <div className="mb-1 text-xs font-semibold text-blue-700 dark:text-blue-400">
                                Actions ({iteration.actions.length})
                            </div>
                            <div className="space-y-2">
                                {iteration.actions.map((action, idx) => (
                                    <div key={idx} className="rounded-lg bg-blue-50 p-3 dark:bg-blue-950/30">
                                        <div className="font-mono text-sm font-semibold text-foreground">{action.tool}</div>
                                        <div className="text-xs text-muted-foreground">{JSON.stringify(action.args)}</div>
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
                    {iteration.observation && (
                        <div>
                            <div className="mb-1 text-xs font-semibold text-purple-700 dark:text-purple-400">Observation</div>
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

// ─── Checkpoint Row ──────────────────────────────────────────────────────────

function CheckpointRow({ checkpoint }: { checkpoint: Checkpoint }) {
    const colors: Record<string, string> = {
        iteration_start: 'bg-gray-100 text-gray-700 dark:bg-gray-800/50 dark:text-gray-300',
        thought:         'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
        tool_call_start: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
        tool_result:     'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
        observation:     'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
        complete:        'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
        max_iterations:  'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    };

    return (
        <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 px-4 py-2.5">
            {/* Sequence number */}
            <span className="mt-0.5 shrink-0 font-mono text-xs font-bold text-muted-foreground">
                #{checkpoint.sequence}
            </span>

            {/* Type badge */}
            <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-xs font-semibold ${colors[checkpoint.type] ?? 'bg-gray-100 text-gray-700'}`}>
                {checkpoint.type}
            </span>

            {/* Metadata */}
            <div className="flex-1 space-y-0.5 overflow-hidden">
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>iter:{checkpoint.iteration}</span>
                    {checkpoint.tool && <span>tool:{checkpoint.tool}</span>}
                    <span className="ml-auto shrink-0">{checkpoint.timestamp}</span>
                </div>
                {checkpoint.idempotency_key && (
                    <div className="truncate font-mono text-xs text-muted-foreground" title={checkpoint.idempotency_key}>
                        idem: {checkpoint.idempotency_key}
                    </div>
                )}
            </div>

            {/* Saved indicator */}
            {checkpoint.saved && (
                <span className="shrink-0 text-xs text-green-600 dark:text-green-400">✓ DB</span>
            )}
        </div>
    );
}

// ─── Status Badge ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: RunStatus }) {
    const config: Record<RunStatus, { label: string; classes: string }> = {
        pending:   { label: 'Pending',   classes: 'bg-gray-100 text-gray-700 dark:bg-gray-800/50 dark:text-gray-300' },
        running:   { label: 'Running',   classes: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
        completed: { label: 'Completed', classes: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
        cancelled: { label: 'Cancelled', classes: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300' },
        failed:    { label: 'Failed',    classes: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
    };
    const { label, classes } = config[status];

    return (
        <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${classes}`}>
            {status === 'running' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
            {label}
        </span>
    );
}

// ─── Past Run Row ────────────────────────────────────────────────────────────

function PastRunRow({ run, onResume }: { run: PastRun; onResume: (id: string) => void }) {
    const canResume = !['pending', 'running'].includes(run.status);
    const task = run.input?.task ?? '(no task)';
    const ago = getRelativeTime(run.created_at);

    return (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background px-4 py-3">
            {/* Run ID */}
            <code className="shrink-0 font-mono text-xs text-muted-foreground">
                {run.id.slice(0, 8)}…
            </code>

            {/* Status */}
            <StatusBadge status={run.status as RunStatus} />

            {/* Task (truncated) */}
            <span className="flex-1 truncate text-sm text-foreground" title={task}>
                {task}
            </span>

            {/* Checkpoint count */}
            <span className="shrink-0 text-xs text-muted-foreground">
                {run.checkpoint_count} checkpoints
            </span>

            {/* Age */}
            <span className="shrink-0 text-xs text-muted-foreground">{ago}</span>

            {/* Resume */}
            <button
                onClick={() => onResume(run.id)}
                disabled={!canResume}
                className="shrink-0 rounded-lg border border-input px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
                Resume
            </button>
        </div>
    );
}

// ─── Stream Listener ─────────────────────────────────────────────────────────

function StreamListener({
    url,
    onEvent,
    onComplete,
    onError,
}: {
    url: string;
    onEvent: (event: MessageEvent) => void;
    onComplete: () => void;
    onError: (error?: any) => void;
}) {
    const handleError = (error?: any) => {
        if (error?.message?.includes('startsWith') || error?.type === 'error') {
            onComplete();
        } else {
            onError(error);
        }
    };

    useEventStream(url, {
        eventName: [
            'iteration', 'thought', 'action', 'observation', 'checkpoint',
            'complete', 'cancelled', 'timed_out', 'max_iterations', 'error',
        ],
        onMessage: onEvent,
        onComplete,
        onError: handleError,
    });

    return null;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function getRelativeTime(isoString: string): string {
    const diff = Date.now() - new Date(isoString).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
}
