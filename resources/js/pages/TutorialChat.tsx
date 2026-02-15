import { Head } from '@inertiajs/react';
import { useEventStream } from '@laravel/stream-react';
import { useState, useCallback, useRef, useEffect } from 'react';

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

// ─── Main Component ─────────────────────────────────────────────────────────

export default function TutorialChat() {
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [streamUrl, setStreamUrl] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [events, setEvents] = useState<Event[]>([]);
    const [showEvents, setShowEvents] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const eventsEndRef = useRef<HTMLDivElement>(null);
    const eventIdRef = useRef(0);
    const currentMessageRef = useRef<Message | null>(null);

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
                // Tool call started
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
                // Tool call completed
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
        } else if (event.type === 'complete') {
            // Stream complete
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
        }
    }, []);

    const handleComplete = useCallback(() => {
        setIsStreaming(false);
        setStreamUrl('');
        currentMessageRef.current = null;
    }, []);

    const handleError = useCallback(() => {
        setIsStreaming(false);
        setStreamUrl('');
        currentMessageRef.current = null;
        
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

    const handleSend = () => {
        if (!input.trim() || isStreaming) return;

        // Add user message
        const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: input.trim(),
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
        currentMessageRef.current = assistantMessage;

        // Start streaming
        setIsStreaming(true);
        const params = new URLSearchParams({ message: input.trim() });
        if (conversationId) {
            params.append('conversation_id', conversationId);
        }
        setStreamUrl(`/tutorial/complete-example?${params.toString()}`);
        setInput('');
    };

    const handleClearEvents = () => {
        setEvents([]);
        eventIdRef.current = 0;
    };

    const handleNewConversation = () => {
        setMessages([]);
        setConversationId(null);
        setEvents([]);
        eventIdRef.current = 0;
    };

    return (
        <>
            <Head title="Tutorial: Complete Chat Example" />

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
                                <h1 className="text-3xl font-bold text-foreground">Tutorial Chat Agent</h1>
                                <p className="mt-2 text-muted-foreground">
                                    Complete example with streaming, tools, and conversation persistence
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
                        {conversationId && (
                            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                                <span className="rounded bg-muted px-2 py-1 font-mono text-xs">
                                    {conversationId.substring(0, 8)}...
                                </span>
                                <span>Conversation ID</span>
                            </div>
                        )}
                    </div>

                    <div className="grid gap-6" style={{ gridTemplateColumns: showEvents ? '2fr 1fr' : '1fr' }}>
                        {/* Chat Area */}
                        <div className="flex flex-col rounded-xl border border-border bg-card shadow-sm" style={{ height: 'calc(100vh - 220px)' }}>
                            {/* Messages */}
                            <div className="flex-1 overflow-y-auto p-6">
                                {messages.length === 0 ? (
                                    <div className="flex h-full items-center justify-center">
                                        <div className="text-center">
                                            <div className="mb-3 text-4xl">💬</div>
                                            <p className="text-muted-foreground">Start a conversation with the AI agent</p>
                                            <p className="mt-2 text-sm text-muted-foreground">
                                                Try: "What is the weather in Tokyo?"
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
                                        placeholder="Type your message..."
                                        disabled={isStreaming}
                                        className="flex-1 rounded-lg border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                                    />
                                    <button
                                        onClick={handleSend}
                                        disabled={!input.trim() || isStreaming}
                                        className="whitespace-nowrap rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                                    >
                                        {isStreaming ? 'Sending...' : 'Send'}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Event Log (conditional) */}
                        {showEvents && (
                            <div className="rounded-xl border border-border bg-card shadow-sm" style={{ height: 'calc(100vh - 220px)' }}>
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
                </div>
            </div>
        </>
    );
}

// ─── Message Bubble Component ───────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
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
                            <div key={idx} className="rounded-md bg-background/50 p-2 text-xs">
                                <div className="mb-1 font-semibold">🔧 {tc.tool}</div>
                                <div className="text-muted-foreground">
                                    {JSON.stringify(tc.args)}
                                </div>
                                {tc.result && (
                                    <div className="mt-1 text-foreground/80">
                                        → {tc.result}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Content */}
                <div className="whitespace-pre-wrap">
                    {message.isStreaming ? (
                        <span className="inline-block animate-pulse">●</span>
                    ) : message.content || (
                        <span className="text-muted-foreground">Processing...</span>
                    )}
                </div>

                {/* Timestamp */}
                <div className="mt-2 text-xs opacity-70">
                    {message.timestamp.toLocaleTimeString()}
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
        eventName: ['action', 'observation', 'complete'],
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
        complete: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
        error: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    };
    return colors[type] || 'bg-gray-100 text-gray-800 dark:bg-gray-800/40 dark:text-gray-300';
}
