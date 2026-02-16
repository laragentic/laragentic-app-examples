import { Head } from '@inertiajs/react';
import { useEventStream } from '@laravel/stream-react';
import axios from 'axios';
import { useState, useCallback, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import McpAppsPanel from './components/McpAppsPanel';

// ─── Types ──────────────────────────────────────────────────────────────────

type Message = {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    isStreaming?: boolean;
    toolCalls?: Array<{ tool: string; args: any; result?: string }>;
};

type Event = {
    id: number;
    timestamp: string;
    type: string;
    data: any;
};

type ElicitationData = {
    type: 'form' | 'url';
    elicitation_id: string;
    message: string;
    requested_schema?: {
        type: string;
        properties: Record<string, SchemaProperty>;
        required?: string[];
    };
    url?: string;
    tool: string;
};

type SchemaProperty = {
    type: string;
    title?: string;
    description?: string;
    enum?: string[];
    default?: any;
    minLength?: number;
    maxLength?: number;
    minimum?: number;
    maximum?: number;
    pattern?: string;
    format?: string;
};

// ─── Main Component ─────────────────────────────────────────────────────────

export default function McpChatDemo() {
    const [mode, setMode] = useState<'legacy' | 'mcp-apps'>(
        (import.meta.env.VITE_MCP_UI_MODE_DEFAULT as 'legacy' | 'mcp-apps' | undefined) ?? 'legacy',
    );
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [streamUrl, setStreamUrl] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [events, setEvents] = useState<Event[]>([]);
    const [showEvents, setShowEvents] = useState(false);
    const [elicitation, setElicitation] = useState<ElicitationData | null>(null);
    const [pendingRetryMessage, setPendingRetryMessage] = useState<string | null>(null);
    const [pendingRetryId, setPendingRetryId] = useState<string | null>(null);
    const [elicitationSubmitError, setElicitationSubmitError] = useState<string | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const eventsEndRef = useRef<HTMLDivElement>(null);
    const eventIdRef = useRef(0);
    const retrySequenceRef = useRef(0);
    const dispatchedRetryIdRef = useRef<string | null>(null);

    // Auto-scroll messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Auto-scroll events
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
        if (event.type === 'action') {
            if (eventData.stage === 'start') {
                setElicitationSubmitError(null);
                setMessages(prev => {
                    const lastMsg = prev[prev.length - 1];
                    if (lastMsg?.isStreaming) {
                        return [...prev.slice(0, -1), {
                            ...lastMsg,
                            toolCalls: [
                                ...(lastMsg.toolCalls || []),
                                { tool: eventData.tool, args: eventData.args }
                            ],
                        }];
                    }
                    return prev;
                });
            } else if (eventData.stage === 'complete') {
                setMessages(prev => {
                    const lastMsg = prev[prev.length - 1];
                    if (lastMsg?.isStreaming && lastMsg.toolCalls) {
                        const updatedToolCalls = lastMsg.toolCalls.map(tc =>
                            tc.tool === eventData.tool && !tc.result
                                ? { ...tc, result: eventData.result }
                                : tc
                        );
                        return [...prev.slice(0, -1), {
                            ...lastMsg,
                            toolCalls: updatedToolCalls,
                        }];
                    }
                    return prev;
                });
            }
        } else if (event.type === 'elicitation') {
            // MCP elicitation request - show form or URL prompt
            setElicitation({
                type: eventData.type,
                elicitation_id: eventData.elicitation_id,
                message: eventData.message,
                requested_schema: eventData.requested_schema,
                url: eventData.url,
                tool: eventData.tool,
            });
        } else if (event.type === 'complete') {
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg?.isStreaming) {
                    return [...prev.slice(0, -1), {
                        ...lastMsg,
                        content: eventData.text,
                        isStreaming: false,
                    }];
                }
                return prev;
            });

            if (eventData.conversationId) {
                setConversationId(eventData.conversationId);
            }
        } else if (event.type === 'error') {
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg?.isStreaming) {
                    return [...prev.slice(0, -1), {
                        ...lastMsg,
                        content: `Error: ${eventData.message}`,
                        isStreaming: false,
                    }];
                }
                return prev;
            });
        }
    }, []);

    const handleComplete = useCallback(() => {
        setIsStreaming(false);
        setStreamUrl('');
    }, []);

    const handleError = useCallback(() => {
        setIsStreaming(false);
        setStreamUrl('');

        setMessages(prev => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg?.isStreaming) {
                return [...prev.slice(0, -1), {
                    ...lastMsg,
                    content: 'Error: Stream failed. Please try again.',
                    isStreaming: false,
                }];
            }
            return prev;
        });
    }, []);

    const handleSend = useCallback((messageText?: string) => {
        const text = messageText || input.trim();
        if (!text || isStreaming) return;
        setElicitationSubmitError(null);

        // Add user message
        const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: text,
            timestamp: new Date(),
        };
        setMessages(prev => [...prev, userMessage]);

        // Add placeholder assistant message
        const assistantMessage: Message = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: '',
            timestamp: new Date(),
            isStreaming: true,
            toolCalls: [],
        };
        setMessages(prev => [...prev, assistantMessage]);

        // Start streaming
        setIsStreaming(true);
        const params = new URLSearchParams({ message: text });
        if (conversationId) {
            params.append('conversation_id', conversationId);
        }
        setStreamUrl(`/tutorial/mcp-chat-stream?${params.toString()}`);
        if (!messageText) setInput('');
    }, [conversationId, input, isStreaming]);

    useEffect(() => {
        if (!pendingRetryMessage || !pendingRetryId || isStreaming || elicitation !== null) {
            return;
        }

        if (dispatchedRetryIdRef.current === pendingRetryId) {
            return;
        }

        dispatchedRetryIdRef.current = pendingRetryId;
        handleSend(pendingRetryMessage);
        setPendingRetryMessage(null);
        setPendingRetryId(null);
    }, [handleSend, isStreaming, pendingRetryId, pendingRetryMessage, elicitation]);

    const handleElicitationSubmit = useCallback(async (elicitationId: string, action: string, data: Record<string, any> | null) => {
        const previousElicitation = elicitation;
        setElicitationSubmitError(null);
        setElicitation(null);
        const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || '';

        // Submit elicitation response to backend
        try {
            await axios.post('/tutorial/mcp-chat-elicitation', {
                elicitation_id: elicitationId,
                action,
                data,
                tool: previousElicitation?.tool ?? null,
            }, {
                withCredentials: true,
                headers: {
                    'X-CSRF-TOKEN': csrfToken,
                    'X-Requested-With': 'XMLHttpRequest',
                }
            });

            if (action === 'accept') {
                const completedTool = previousElicitation?.tool ?? 'requested_tool';
                const nextRetryId = `retry_${++retrySequenceRef.current}`;
                setPendingRetryId(nextRetryId);
                setPendingRetryMessage(`I have completed the requested information for ${completedTool}. Please continue.`);
            }
        } catch (err) {
            if (previousElicitation) {
                setElicitation(previousElicitation);
            }
            console.error('Elicitation submission failed:', err);
            if (axios.isAxiosError(err)) {
                const status = err.response?.status;
                if (status) {
                    setElicitationSubmitError(`Unable to submit credentials (${status}). Please try again.`);
                    return;
                }
            }
            setElicitationSubmitError('Unable to submit credentials. Please check your connection and try again.');
        }
    }, [elicitation]);

    const handleResetCredentials = useCallback(async () => {
        try {
            const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || '';
            await axios.post('/tutorial/mcp-chat-reset', {}, {
                withCredentials: true,
                headers: {
                    'X-CSRF-TOKEN': csrfToken,
                    'X-Requested-With': 'XMLHttpRequest',
                },
            });
        } catch (err) {
            console.error('Reset failed:', err);
        }
    }, []);

    const handleNewConversation = () => {
        setMessages([]);
        setConversationId(null);
        setEvents([]);
        setElicitation(null);
        setPendingRetryMessage(null);
        setPendingRetryId(null);
        setElicitationSubmitError(null);
        eventIdRef.current = 0;
        dispatchedRetryIdRef.current = null;
        handleResetCredentials();
    };

    const handleClearEvents = () => {
        setEvents([]);
        eventIdRef.current = 0;
    };

    return (
        <>
            <Head title="MCP Chat Demo" />

            {mode === 'legacy' && streamUrl && (
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
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                            <button
                                onClick={() => setMode('legacy')}
                                className={`rounded px-3 py-1.5 text-sm ${mode === 'legacy' ? 'bg-primary text-primary-foreground' : 'border border-input'}`}
                            >
                                Legacy (SSE)
                            </button>
                            <button
                                onClick={() => setMode('mcp-apps')}
                                className={`rounded px-3 py-1.5 text-sm ${mode === 'mcp-apps' ? 'bg-primary text-primary-foreground' : 'border border-input'}`}
                            >
                                MCP Apps
                            </button>
                        </div>
                        <div className="flex items-start justify-between">
                            <div>
                                <h1 className="text-3xl font-bold text-foreground">MCP Chat Demo</h1>
                                <p className="mt-2 text-muted-foreground">
                                    Project management agent with MCP-style elicitation, tools, and conversation persistence
                                </p>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setShowEvents(!showEvents)}
                                    className="whitespace-nowrap rounded-lg border border-input px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                                >
                                    {showEvents ? 'Hide' : 'Show'} Events
                                </button>
                                <button
                                    onClick={handleNewConversation}
                                    disabled={isStreaming || messages.length === 0}
                                    className="whitespace-nowrap rounded-lg border border-input px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
                                >
                                    New Conversation
                                </button>
                            </div>
                        </div>
                        {mode === 'legacy' && conversationId && (
                            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                                <span className="rounded bg-muted px-2 py-1 font-mono text-xs">
                                    {conversationId.substring(0, 8)}...
                                </span>
                                <span>Conversation ID</span>
                            </div>
                        )}

                        {/* Quick actions */}
                        {mode === 'legacy' && <div className="mt-3 flex flex-wrap gap-2">
                            <QuickAction
                                label="List projects"
                                onClick={() => handleSend('Show me all my projects')}
                                disabled={isStreaming}
                            />
                            <QuickAction
                                label="Create project"
                                onClick={() => handleSend('Create a new fullstack project called "My Dashboard"')}
                                disabled={isStreaming}
                            />
                            <QuickAction
                                label="Deploy (triggers elicitation)"
                                onClick={() => handleSend('Deploy project proj_a1b2c3d4 to staging')}
                                disabled={isStreaming}
                            />
                            <QuickAction
                                label="Security review form"
                                onClick={() => handleSend('Run a security review for project proj_a1b2c3d4.')}
                                disabled={isStreaming}
                            />
                            <QuickAction
                                label="Repository auth URL"
                                onClick={() => handleSend('Connect repository access for project proj_e5f6g7h8 using GitHub.')}
                                disabled={isStreaming}
                            />
                            <QuickAction
                                label="Incident escalation form"
                                onClick={() => handleSend('Create an incident escalation plan for service api-gateway.')}
                                disabled={isStreaming}
                            />
                        </div>}
                        {mode === 'legacy' && pendingRetryMessage && (
                            <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">
                                Credentials saved. Retrying deployment...
                            </p>
                        )}
                    </div>

                    {mode === 'mcp-apps' ? (
                        <McpAppsPanel />
                    ) : (
                    <div className="grid gap-6" style={{ gridTemplateColumns: showEvents ? '2fr 1fr' : '1fr' }}>
                        {/* Chat Area */}
                        <div className="relative flex flex-col rounded-xl border border-border bg-card shadow-sm" style={{ height: 'calc(100vh - 280px)' }}>
                            {/* Messages */}
                            <div className="flex-1 overflow-y-auto p-6">
                                {messages.length === 0 ? (
                                    <div className="flex h-full items-center justify-center">
                                        <div className="text-center">
                                            <div className="mb-3 text-4xl">&#x1F527;</div>
                                            <p className="font-medium text-foreground">Project Manager AI</p>
                                            <p className="mt-1 text-sm text-muted-foreground">
                                                Powered by Laragentic + MCP + Laravel AI SDK
                                            </p>
                                            <p className="mt-3 text-sm text-muted-foreground">
                                                Try: "List my projects" or "Deploy a project to staging"
                                            </p>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {messages.map((msg) => (
                                            <MessageBubble key={msg.id} message={msg} />
                                        ))}
                                        <div ref={messagesEndRef} />
                                    </div>
                                )}
                            </div>

                            {/* Elicitation overlay */}
                            {elicitation?.type === 'form' && (
                                <ElicitationForm
                                    elicitation={elicitation}
                                    onSubmit={handleElicitationSubmit}
                                    onCancel={() => handleElicitationSubmit(elicitation.elicitation_id, 'cancel', null)}
                                    submitError={elicitationSubmitError}
                                />
                            )}

                            {elicitation?.type === 'url' && (
                                <ElicitationUrl
                                    elicitation={elicitation}
                                    onComplete={(id) => handleElicitationSubmit(id, 'accept', null)}
                                    onCancel={() => handleElicitationSubmit(elicitation.elicitation_id, 'cancel', null)}
                                    submitError={elicitationSubmitError}
                                />
                            )}

                            {/* Input */}
                            <div className="border-t border-border p-4">
                                <div className="flex gap-3">
                                    <input
                                        type="text"
                                        value={input}
                                        onChange={(e) => setInput(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                handleSend();
                                            }
                                        }}
                                        placeholder={elicitation ? 'Complete the form above to continue...' : 'Ask about your projects...'}
                                        disabled={isStreaming || elicitation !== null}
                                        className="flex-1 rounded-lg border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                                    />
                                    <button
                                        onClick={() => handleSend()}
                                        disabled={!input.trim() || isStreaming || elicitation !== null}
                                        className="whitespace-nowrap rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                                    >
                                        {isStreaming ? 'Sending...' : 'Send'}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Event Log */}
                        {showEvents && (
                            <div className="rounded-xl border border-border bg-card shadow-sm" style={{ height: 'calc(100vh - 280px)' }}>
                                <div className="border-b border-border px-4 py-3">
                                    <div className="flex items-center justify-between">
                                        <h3 className="font-semibold text-foreground">Event Log</h3>
                                        {events.length > 0 && (
                                            <button
                                                onClick={handleClearEvents}
                                                className="text-xs text-muted-foreground hover:text-foreground"
                                            >
                                                Clear
                                            </button>
                                        )}
                                    </div>
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
                    )}
                </div>
            </div>
        </>
    );
}

// ─── Quick Action Button ────────────────────────────────────────────────────

function QuickAction({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className="rounded-full border border-input px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
            {label}
        </button>
    );
}

// ─── Message Bubble Component ───────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
    const markdownComponents = {
        table: ({ children }: { children?: React.ReactNode }) => (
            <div className="my-2 w-full overflow-x-auto">
                <table className="w-full min-w-max border-collapse">{children}</table>
            </div>
        ),
        th: ({ children }: { children?: React.ReactNode }) => (
            <th className="border-b border-border px-3 py-2 text-left font-semibold whitespace-nowrap">{children}</th>
        ),
        td: ({ children }: { children?: React.ReactNode }) => (
            <td className="border-b border-border/60 px-3 py-2 align-top">{children}</td>
        ),
        a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
            <a href={href} target="_blank" rel="noreferrer" className="break-all underline">
                {children}
            </a>
        ),
    };

    return (
        <div className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-lg px-4 py-3 ${
                message.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground'
            }`}>
                {/* Tool calls */}
                {message.toolCalls && message.toolCalls.length > 0 && (
                    <div className="mb-3 space-y-2">
                        {message.toolCalls.map((tc, idx) => (
                            <ToolCallIndicator key={idx} toolCall={tc} />
                        ))}
                    </div>
                )}

                {/* Content */}
                {message.role === 'user' ? (
                    <div className="text-primary-foreground whitespace-pre-wrap break-words">
                        {message.content || <span className="opacity-80">Processing...</span>}
                    </div>
                ) : (
                    <div className="prose-sm dark:prose-invert prose prose-p:m-0 prose-li:m-0 prose-ul:m-0 prose-ol:m-0 prose-h1:m-0 prose-h2:m-0 prose-h3:m-0 max-w-full overflow-x-auto">
                        {message.isStreaming ? (
                            <span className="inline-block animate-pulse">&#x25CF;</span>
                        ) : message.content ? (
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                                {message.content}
                            </ReactMarkdown>
                        ) : (
                            <span className="text-muted-foreground">Processing...</span>
                        )}
                    </div>
                )}

                {/* Timestamp */}
                <div className="mt-2 text-xs opacity-70">
                    {message.timestamp.toLocaleTimeString()}
                </div>
            </div>
        </div>
    );
}

// ─── Tool Call Indicator ────────────────────────────────────────────────────

function ToolCallIndicator({ toolCall }: { toolCall: { tool: string; args: any; result?: string } }) {
    const [expanded, setExpanded] = useState(false);
    const toolIcon = getToolIcon(toolCall.tool);

    return (
        <div className="rounded-md bg-background/50 p-2 text-xs">
            <button
                onClick={() => setExpanded(!expanded)}
                className="flex w-full items-center gap-1 text-left"
            >
                <span>{toolIcon}</span>
                <span className="font-semibold">{toolCall.tool}</span>
                {toolCall.result ? (
                    <span className="ml-auto text-green-600 dark:text-green-400">done</span>
                ) : (
                    <span className="ml-auto animate-pulse text-yellow-600 dark:text-yellow-400">running...</span>
                )}
            </button>
            {expanded && (
                <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
                    <div className="text-muted-foreground">
                        <span className="font-medium">Args:</span> {JSON.stringify(toolCall.args)}
                    </div>
                    {toolCall.result && (
                        <div className="text-foreground/80">
                            <span className="font-medium">Result:</span> {toolCall.result.substring(0, 200)}
                            {toolCall.result.length > 200 && '...'}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── Elicitation Form Component ─────────────────────────────────────────────

function ElicitationForm({
    elicitation,
    onSubmit,
    onCancel,
    submitError,
}: {
    elicitation: ElicitationData;
    onSubmit: (id: string, action: string, data: Record<string, any> | null) => void;
    onCancel: () => void;
    submitError: string | null;
}) {
    const { elicitation_id, message, requested_schema } = elicitation;
    const properties = requested_schema?.properties || {};
    const required = requested_schema?.required || [];

    const [formData, setFormData] = useState<Record<string, any>>(() => {
        const defaults: Record<string, any> = {};
        Object.entries(properties).forEach(([key, schema]) => {
            if (schema.default !== undefined) {
                defaults[key] = schema.default;
            } else if (schema.type === 'boolean') {
                defaults[key] = false;
            } else {
                defaults[key] = '';
            }
        });
        return defaults;
    });

    const [errors, setErrors] = useState<Record<string, string>>({});

    const validate = () => {
        const newErrors: Record<string, string> = {};
        required.forEach(key => {
            if (!formData[key] && formData[key] !== 0 && formData[key] !== false) {
                newErrors[key] = 'This field is required';
            }
        });
        Object.entries(properties).forEach(([key, schema]) => {
            const val = formData[key];
            if (val && schema.minLength && String(val).length < schema.minLength) {
                newErrors[key] = `Minimum ${schema.minLength} characters`;
            }
            if (val && schema.maxLength && String(val).length > schema.maxLength) {
                newErrors[key] = `Maximum ${schema.maxLength} characters`;
            }
        });
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (validate()) {
            onSubmit(elicitation_id, 'accept', formData);
        }
    };

    const renderField = (key: string, schema: SchemaProperty) => {
        const label = schema.title || key;
        const desc = schema.description;
        const isRequired = required.includes(key);

        if (schema.enum) {
            return (
                <div key={key} className="space-y-1">
                    <label className="block text-sm font-medium text-foreground">
                        {label} {isRequired && <span className="text-red-500">*</span>}
                    </label>
                    {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
                    <select
                        value={formData[key] || ''}
                        onChange={e => setFormData(prev => ({ ...prev, [key]: e.target.value }))}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                    >
                        <option value="">Select...</option>
                        {schema.enum.map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                        ))}
                    </select>
                    {errors[key] && <p className="text-xs text-red-500">{errors[key]}</p>}
                </div>
            );
        }

        if (schema.type === 'boolean') {
            return (
                <div key={key} className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={formData[key] || false}
                        onChange={e => setFormData(prev => ({ ...prev, [key]: e.target.checked }))}
                        className="rounded border-input"
                    />
                    <label className="text-sm font-medium text-foreground">{label}</label>
                    {desc && <p className="text-xs text-muted-foreground">- {desc}</p>}
                </div>
            );
        }

        if (schema.type === 'number' || schema.type === 'integer') {
            return (
                <div key={key} className="space-y-1">
                    <label className="block text-sm font-medium text-foreground">
                        {label} {isRequired && <span className="text-red-500">*</span>}
                    </label>
                    {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
                    <input
                        type="number"
                        value={formData[key] || ''}
                        min={schema.minimum}
                        max={schema.maximum}
                        step={schema.type === 'integer' ? 1 : 'any'}
                        onChange={e => setFormData(prev => ({ ...prev, [key]: Number(e.target.value) }))}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                    />
                    {errors[key] && <p className="text-xs text-red-500">{errors[key]}</p>}
                </div>
            );
        }

        return (
            <div key={key} className="space-y-1">
                <label className="block text-sm font-medium text-foreground">
                    {label} {isRequired && <span className="text-red-500">*</span>}
                </label>
                {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
                <input
                    type={schema.format === 'email' ? 'email' : schema.format === 'uri' ? 'url' : 'text'}
                    value={formData[key] || ''}
                    onChange={e => setFormData(prev => ({ ...prev, [key]: e.target.value }))}
                    placeholder={schema.title || key}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
                />
                {errors[key] && <p className="text-xs text-red-500">{errors[key]}</p>}
            </div>
        );
    };

    return (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="mx-4 w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
                <div className="mb-1 flex items-center gap-2">
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                        MCP Elicitation
                    </span>
                </div>
                <h2 className="text-lg font-semibold text-foreground">Information Required</h2>
                <p className="mt-1 text-sm text-muted-foreground">{message}</p>
                <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300">
                    Demo API key: <span className="font-mono font-semibold">demo-api-key-12345</span>
                </div>
                {submitError && (
                    <p className="mt-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                        {submitError}
                    </p>
                )}

                <form onSubmit={handleSubmit} className="mt-4 space-y-4">
                    {Object.entries(properties).map(([key, schema]) =>
                        renderField(key, schema)
                    )}

                    <div className="flex gap-2 justify-end pt-2">
                        <button
                            type="button"
                            onClick={() => onSubmit(elicitation_id, 'decline', null)}
                            className="rounded-lg px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent"
                        >
                            Decline
                        </button>
                        <button
                            type="button"
                            onClick={onCancel}
                            className="rounded-lg px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                        >
                            Submit
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// ─── URL Elicitation Component ──────────────────────────────────────────────

function ElicitationUrl({
    elicitation,
    onComplete,
    onCancel,
    submitError,
}: {
    elicitation: ElicitationData;
    onComplete: (id: string) => void;
    onCancel: () => void;
    submitError: string | null;
}) {
    const { elicitation_id, message, url } = elicitation;
    const [hasOpened, setHasOpened] = useState(false);

    let domain = '';
    let pathname = '';
    if (url) {
        try {
            const parsed = new URL(url);
            domain = parsed.hostname;
            pathname = parsed.pathname + parsed.search;
        } catch {
            domain = url;
        }
    }

    const handleOpen = () => {
        if (url) {
            window.open(url, '_blank', 'noopener,noreferrer');
        }
        setHasOpened(true);
    };

    return (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="mx-4 w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
                <div className="mb-1 flex items-center gap-2">
                    <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                        Authorization
                    </span>
                </div>
                <h2 className="text-lg font-semibold text-foreground">Authorization Required</h2>
                <p className="mt-1 text-sm text-muted-foreground">{message}</p>
                {submitError && (
                    <p className="mt-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                        {submitError}
                    </p>
                )}

                {url && (
                    <div className="mt-3 rounded-lg bg-muted p-3 break-all">
                        <p className="mb-1 text-xs text-muted-foreground">You will be directed to:</p>
                        <p className="text-sm">
                            <span className="font-semibold text-blue-700 dark:text-blue-400">{domain}</span>
                            <span className="text-muted-foreground">{pathname}</span>
                        </p>
                    </div>
                )}

                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
                    <p className="text-xs text-amber-800 dark:text-amber-300">
                        This will open in a new window. Complete the authorization there,
                        then return here and click "I've completed this."
                    </p>
                </div>

                <div className="mt-4 flex gap-2 justify-end">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="rounded-lg px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent"
                    >
                        Cancel
                    </button>

                    {!hasOpened ? (
                        <button
                            type="button"
                            onClick={handleOpen}
                            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                        >
                            Open Authorization Page
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={() => onComplete(elicitation_id)}
                            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700"
                        >
                            I've Completed This
                        </button>
                    )}
                </div>
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
    const handleError = (error?: any) => {
        if (error?.message?.includes('startsWith') || error?.type === 'error') {
            console.log('Stream closed (EventSource error event - likely normal closure)');
            onComplete();
        } else {
            console.error('Stream error:', error);
            onError();
        }
    };

    useEventStream(url, {
        eventName: ['action', 'observation', 'elicitation', 'complete', 'error'],
        onMessage: onEvent,
        onComplete,
        onError: handleError,
    });

    return null;
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function getEventColor(type: string): string {
    const colors: Record<string, string> = {
        action: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
        observation: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
        elicitation: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
        complete: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
        error: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    };
    return colors[type] || 'bg-gray-100 text-gray-800 dark:bg-gray-800/40 dark:text-gray-300';
}

function getToolIcon(tool: string): string {
    const icons: Record<string, string> = {
        create_project: '\u{1F4E6}',
        deploy_project: '\u{1F680}',
        list_projects: '\u{1F4CB}',
        search: '\u{1F50D}',
    };
    return icons[tool] || '\u{1F527}';
}
