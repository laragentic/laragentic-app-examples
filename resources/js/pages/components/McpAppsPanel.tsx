import { AppRenderer, UIResourceRenderer } from '@mcp-ui/client';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type NormalizedUiResource = {
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
    _meta?: Record<string, unknown>;
};

type McpUiResourcePayload = {
    type: 'resource';
    resource: {
        uri: string;
        mimeType?: string;
        text?: string;
        blob?: string;
        _meta?: Record<string, unknown>;
    };
};

type ToolItem = {
    name: string;
    description?: string;
    appResourceUri?: string;
};

type NextAction = {
    label: string;
    toolName: string;
    params: Record<string, unknown>;
};

type ChatItem = {
    id: number;
    role: 'user' | 'assistant' | 'system';
    text: string;
    resource?: NormalizedUiResource;
    toolResult?: CallToolResult;
    toolName?: string;
    appResourceUri?: string;
    nextActions?: NextAction[];
};

type McpConnectionState = {
    connected: boolean;
    authenticated: boolean;
    authMessage: string;
    error?: string;
};

type McpUiToolInvocationEvent = {
    id: number;
    timestamp: string;
    kind: 'chat' | 'tool' | 'ui' | 'app' | 'auth' | 'error';
    details: string;
};

type OAuthSessionResponse = {
    authenticated?: boolean;
    user?: { login?: string };
};

function isResourceContent(item: unknown): item is McpUiResourcePayload {
    if (!item || typeof item !== 'object') {
        return false;
    }

    const content = item as { type?: unknown; resource?: unknown };
    if (content.type !== 'resource') {
        return false;
    }

    if (!content.resource || typeof content.resource !== 'object') {
        return false;
    }

    const resource = content.resource as { uri?: unknown };
    return typeof resource.uri === 'string';
}

function isCallToolResult(value: unknown): value is CallToolResult {
    if (!value || typeof value !== 'object') {
        return false;
    }

    if (!('content' in value)) {
        return false;
    }

    return Array.isArray((value as { content?: unknown }).content);
}

function textContentFromResult(result: CallToolResult): string {
    const textParts = result.content
        .filter((item): item is Extract<(typeof result.content)[number], { type: 'text' }> => item.type === 'text')
        .map((item) => item.text);

    return textParts.join('\n\n').trim();
}

function normalizeResource(resource?: McpUiResourcePayload['resource']): NormalizedUiResource | undefined {
    if (!resource) {
        return undefined;
    }

    const mimeType = resource.mimeType;
    if (mimeType === 'text/html;profile=mcp-app' || mimeType === 'text/html+skybridge') {
        return {
            ...resource,
            mimeType: 'text/html',
        };
    }

    if (!mimeType && (typeof resource.text === 'string' || typeof resource.blob === 'string')) {
        return {
            ...resource,
            mimeType: 'text/html',
        };
    }

    return resource;
}

function isAppCompatible(resource?: NormalizedUiResource): boolean {
    if (!resource) {
        return false;
    }

    if (resource.mimeType === 'text/html') {
        return true;
    }

    return resource.uri.startsWith('ui://mcp-demo/apps/');
}

function parseChatMeta(result: CallToolResult): { conversationId?: string; nextActions: NextAction[] } {
    const meta = (result as { _meta?: unknown })._meta;
    if (!meta || typeof meta !== 'object') {
        return { nextActions: [] };
    }

    const chat = (meta as { chat?: unknown }).chat;
    if (!chat || typeof chat !== 'object') {
        return { nextActions: [] };
    }

    const conversationId = typeof (chat as { conversation_id?: unknown }).conversation_id === 'string'
        ? (chat as { conversation_id: string }).conversation_id
        : undefined;

    const rawActions = Array.isArray((chat as { next_actions?: unknown }).next_actions)
        ? (chat as { next_actions: unknown[] }).next_actions
        : [];

    const nextActions: NextAction[] = rawActions
        .map((entry) => {
            if (!entry || typeof entry !== 'object') {
                return null;
            }
            const label = (entry as { label?: unknown }).label;
            const toolName = (entry as { toolName?: unknown }).toolName;
            const params = (entry as { params?: unknown }).params;
            if (typeof label !== 'string' || typeof toolName !== 'string') {
                return null;
            }
            return {
                label,
                toolName,
                params: params && typeof params === 'object' ? (params as Record<string, unknown>) : {},
            };
        })
        .filter((entry): entry is NextAction => entry !== null);

    return { conversationId, nextActions };
}

export default function McpAppsPanel() {
    const configuredMcpUrl = import.meta.env.VITE_MCP_APPS_URL ?? 'http://127.0.0.1:3232/mcp';
    const configuredOAuthAuthorizeUrl = import.meta.env.VITE_MCP_OAUTH_AUTHORIZE_URL ?? 'http://127.0.0.1:3232/oauth/authorize';

    const [connection, setConnection] = useState<McpConnectionState>({
        connected: false,
        authenticated: false,
        authMessage: 'Not authenticated',
    });
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const [chatItems, setChatItems] = useState<ChatItem[]>([]);
    const [events, setEvents] = useState<McpUiToolInvocationEvent[]>([]);
    const [rawRequest, setRawRequest] = useState<string>('');
    const [rawResponse, setRawResponse] = useState<string>('');
    const [conversationId, setConversationId] = useState<string | null>(null);

    const eventCounterRef = useRef(0);
    const chatCounterRef = useRef(0);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const clientRef = useRef<Client | null>(null);
    const transportRef = useRef<StreamableHTTPClientTransport | null>(null);
    const toolMapRef = useRef<Map<string, ToolItem>>(new Map());

    const normalizedMcpBase = useMemo(() => {
        const base = new URL(configuredMcpUrl);
        const appHost = window.location.hostname;
        const baseHost = base.hostname;
        const isLoopbackPair =
            (appHost === 'localhost' && baseHost === '127.0.0.1') ||
            (appHost === '127.0.0.1' && baseHost === 'localhost');
        if (isLoopbackPair) {
            base.hostname = appHost;
        }
        return base;
    }, [configuredMcpUrl]);

    const mcpUrl = useMemo(() => normalizedMcpBase.toString(), [normalizedMcpBase]);

    const oauthAuthorizeUrl = useMemo(() => {
        const url = new URL(configuredOAuthAuthorizeUrl);
        const appHost = window.location.hostname;
        const authHost = url.hostname;
        const isLoopbackPair =
            (appHost === 'localhost' && authHost === '127.0.0.1') ||
            (appHost === '127.0.0.1' && authHost === 'localhost');
        if (isLoopbackPair) {
            url.hostname = appHost;
        }
        return url.toString();
    }, [configuredOAuthAuthorizeUrl]);

    const sandboxUrl = useMemo(() => {
        const base = new URL(mcpUrl);
        return new URL('/sandbox_proxy.html', `${base.protocol}//${base.host}`);
    }, [mcpUrl]);

    const appendEvent = useCallback((kind: McpUiToolInvocationEvent['kind'], details: string) => {
        eventCounterRef.current += 1;
        setEvents((prev) => {
            const next = [
                ...prev,
                {
                    id: eventCounterRef.current,
                    timestamp: new Date().toLocaleTimeString(),
                    kind,
                    details,
                },
            ];
            return next.slice(-20);
        });
    }, []);

    const appendChat = useCallback((item: Omit<ChatItem, 'id'>) => {
        chatCounterRef.current += 1;
        setChatItems((prev) => [...prev, { ...item, id: chatCounterRef.current }]);
    }, []);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatItems]);

    const getSession = useCallback(async (): Promise<OAuthSessionResponse | null> => {
        try {
            const response = await fetch(new URL('/oauth/session', normalizedMcpBase.origin).toString(), {
                credentials: 'include',
            });

            if (!response.ok) {
                return null;
            }

            return (await response.json()) as OAuthSessionResponse;
        } catch {
            return null;
        }
    }, [normalizedMcpBase.origin]);

    const refreshSession = useCallback(async () => {
        const payload = await getSession();
        if (!payload) {
            setConnection((prev) => ({
                ...prev,
                authenticated: false,
                authMessage: 'Unable to verify auth session',
            }));
            return;
        }

        if (payload.authenticated) {
            setConnection((prev) => ({
                ...prev,
                authenticated: true,
                authMessage: `Authenticated${payload.user?.login ? ` as ${payload.user.login}` : ''}`,
            }));
            return;
        }

        setConnection((prev) => ({
            ...prev,
            authenticated: false,
            authMessage: 'Not authenticated',
        }));
    }, [getSession]);

    const disconnect = useCallback(async () => {
        try {
            if (transportRef.current) {
                await transportRef.current.close();
            }
            if (clientRef.current) {
                await clientRef.current.close();
            }
        } catch {
            // no-op
        } finally {
            transportRef.current = null;
            clientRef.current = null;
            toolMapRef.current = new Map();
            setConnection((prev) => ({ ...prev, connected: false }));
            appendEvent('auth', 'Disconnected from MCP sidecar');
        }
    }, [appendEvent]);

    const connect = useCallback(async () => {
        setConnection((prev) => ({ ...prev, error: undefined }));

        try {
            await disconnect();
            const session = await getSession();
            if (!session?.authenticated) {
                setConnection((prev) => ({
                    ...prev,
                    connected: false,
                    authenticated: false,
                    authMessage: 'Authentication required',
                    error: 'Sign in with GitHub first.',
                }));
                appendEvent('auth', 'Connect blocked: not authenticated');
                return;
            }

            const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
                requestInit: { credentials: 'include' },
            });
            const client = new Client({
                name: 'laragentic-mcp-chat-ui',
                version: '1.0.0',
            });

            await client.connect(transport);

            const tools = await client.listTools();
            const toolMap = new Map<string, ToolItem>();
            tools.tools.forEach((tool) => {
                const appUriCandidate = tool._meta?.['ui/resourceUri'];
                toolMap.set(tool.name, {
                    name: tool.name,
                    description: tool.description,
                    appResourceUri: typeof appUriCandidate === 'string' ? appUriCandidate : undefined,
                });
            });

            toolMapRef.current = toolMap;
            transportRef.current = transport;
            clientRef.current = client;

            setConnection({
                connected: true,
                authenticated: true,
                authMessage: `Connected${session.user?.login ? ` as ${session.user.login}` : ''}`,
            });
            appendEvent('auth', 'Connected to MCP sidecar');
        } catch (caught) {
            const message = caught instanceof Error ? caught.message : 'MCP connection failed';
            setConnection((prev) => ({ ...prev, connected: false, error: message }));
            appendEvent('error', `Connect failed: ${message}`);
        }
    }, [appendEvent, disconnect, getSession, mcpUrl]);

    const executeTool = useCallback(async (params: {
        toolName: string;
        args: Record<string, unknown>;
        kind: McpUiToolInvocationEvent['kind'];
        userMessage?: string;
    }): Promise<CallToolResult | null> => {
        const client = clientRef.current;
        if (!client) {
            setConnection((prev) => ({ ...prev, error: 'Connect to MCP first.' }));
            appendEvent('error', `Cannot call ${params.toolName}: client not connected`);
            return null;
        }

        if (params.userMessage) {
            appendChat({ role: 'user', text: params.userMessage });
        }

        setSending(true);
        setConnection((prev) => ({ ...prev, error: undefined }));
        setRawRequest(JSON.stringify({ tool: params.toolName, arguments: params.args }, null, 2));
        appendEvent(params.kind, `Calling ${params.toolName}`);

        try {
            const result = await client.callTool(
                {
                    name: params.toolName,
                    arguments: params.args,
                },
                CallToolResultSchema,
            );

            if (!isCallToolResult(result)) {
                throw new Error('MCP server returned a non-standard tool result.');
            }

            setRawResponse(JSON.stringify(result, null, 2));

            let resource: McpUiResourcePayload['resource'] | undefined;
            for (const contentItem of result.content) {
                if (isResourceContent(contentItem)) {
                    resource = contentItem.resource;
                    break;
                }
            }

            const text = textContentFromResult(result) || `${params.toolName} completed.`;
            const chatMeta = parseChatMeta(result);
            if (chatMeta.conversationId) {
                setConversationId(chatMeta.conversationId);
            }

            appendChat({
                role: 'assistant',
                text,
                resource: normalizeResource(resource),
                toolResult: result,
                toolName: params.toolName,
                appResourceUri: toolMapRef.current.get(params.toolName)?.appResourceUri,
                nextActions: chatMeta.nextActions,
            });

            appendEvent(params.kind, `${params.toolName} complete`);
            return result;
        } catch (caught) {
            const message = caught instanceof Error ? caught.message : `Failed to call ${params.toolName}`;
            setConnection((prev) => ({ ...prev, error: message }));
            appendChat({ role: 'system', text: `Error: ${message}` });
            appendEvent('error', `${params.toolName} failed: ${message}`);
            return null;
        } finally {
            setSending(false);
        }
    }, [appendChat, appendEvent]);

    const sendChat = useCallback(async (messageText?: string) => {
        const text = (messageText ?? input).trim();
        if (!text || sending) {
            return;
        }

        if (!connection.connected) {
            appendChat({ role: 'user', text });
            appendChat({ role: 'system', text: 'Connect and authenticate first to use MCP Apps chat.' });
            return;
        }

        setInput('');
        await executeTool({
            toolName: 'chat_turn',
            args: {
                message: text,
                conversation_id: conversationId ?? undefined,
            },
            kind: 'chat',
            userMessage: text,
        });
    }, [appendChat, connection.connected, conversationId, executeTool, input, sending]);

    const handleUiAction = useCallback(async (action: {
        type: 'tool' | 'notify' | 'link' | 'prompt' | 'intent';
        payload: any;
    }) => {
        if (action.type === 'tool') {
            const toolName = action.payload.toolName;
            const args = action.payload.params && typeof action.payload.params === 'object'
                ? (action.payload.params as Record<string, unknown>)
                : {};
            await executeTool({
                toolName,
                args,
                kind: 'ui',
                userMessage: `[UI] ${toolName}`,
            });
            return;
        }

        if (action.type === 'notify') {
            appendChat({ role: 'system', text: action.payload.message });
            appendEvent('ui', `notify: ${action.payload.message}`);
            return;
        }

        if (action.type === 'link') {
            window.open(action.payload.url, '_blank', 'noopener,noreferrer');
            appendEvent('ui', `link: ${action.payload.url}`);
            return;
        }

        const content = action.payload?.prompt ?? action.payload?.intent ?? 'Unhandled UI action.';
        appendChat({ role: 'system', text: String(content) });
        appendEvent('ui', String(content));
    }, [appendChat, appendEvent, executeTool]);

    useEffect(() => {
        void refreshSession();

        const onMessage = (event: MessageEvent) => {
            if (event.data && typeof event.data === 'object' && 'type' in event.data && event.data.type === 'mcp-oauth-complete') {
                appendEvent('auth', 'OAuth completed, refreshing session');
                void refreshSession();
            }
        };

        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [appendEvent, refreshSession]);

    useEffect(() => {
        return () => {
            void disconnect();
        };
    }, [disconnect]);

    const quickPrompts = [
        'Show me all my projects',
        'Create a fullstack project called "MCP UI Demo"',
        'Deploy project proj_a1b2c3d4 to staging',
        'Run security review for proj_a1b2c3d4',
    ];

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
        <div className="flex flex-col rounded-xl border border-border bg-card shadow-sm" style={{ height: 'calc(100vh - 220px)' }}>
            <div className="border-b border-border px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <span className={`rounded px-2 py-1 text-xs font-semibold ${connection.connected ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' : 'bg-muted text-muted-foreground'}`}>
                            {connection.connected ? 'Connected' : 'Not connected'}
                        </span>
                        <span className={`rounded px-2 py-1 text-xs font-semibold ${connection.authenticated ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' : 'bg-muted text-muted-foreground'}`}>
                            {connection.authenticated ? 'Authenticated' : 'Not authenticated'}
                        </span>
                        <span className="text-sm text-muted-foreground">{connection.authMessage}</span>
                    </div>

                    <button
                        onClick={() => setDrawerOpen((prev) => !prev)}
                        className="rounded border border-input px-3 py-1.5 text-xs text-foreground"
                    >
                        {drawerOpen ? 'Hide Dev Drawer' : 'Show Dev Drawer'}
                    </button>
                </div>

                {connection.error && (
                    <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                        {connection.error}
                    </p>
                )}
            </div>

            {drawerOpen && (
                <div className="border-b border-border bg-muted/20 p-4">
                    <div className="mb-3 flex flex-wrap gap-2">
                        <button
                            onClick={() => void connect()}
                            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                        >
                            Connect
                        </button>
                        <button
                            onClick={() => window.open(`${oauthAuthorizeUrl}?return_to=${encodeURIComponent(window.location.href)}`, '_blank', 'noopener,noreferrer')}
                            className="rounded-lg border border-input px-4 py-2 text-sm"
                        >
                            Sign in with GitHub
                        </button>
                        <button
                            onClick={() => void disconnect()}
                            className="rounded-lg border border-input px-4 py-2 text-sm"
                        >
                            Disconnect
                        </button>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded border border-border bg-background p-3">
                            <p className="mb-2 text-xs font-semibold text-foreground">Last Request</p>
                            <pre className="max-h-44 overflow-auto text-xs text-foreground/80">{rawRequest || 'No request yet'}</pre>
                        </div>
                        <div className="rounded border border-border bg-background p-3">
                            <p className="mb-2 text-xs font-semibold text-foreground">Last Response</p>
                            <pre className="max-h-44 overflow-auto text-xs text-foreground/80">{rawResponse || 'No response yet'}</pre>
                        </div>
                    </div>

                    <div className="mt-3 rounded border border-border bg-background p-3">
                        <p className="mb-2 text-xs font-semibold text-foreground">Events (last 20)</p>
                        {events.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No events yet</p>
                        ) : (
                            <div className="space-y-1">
                                {events.map((event) => (
                                    <div key={event.id} className="rounded bg-muted/50 px-2 py-1 text-xs">
                                        <span className="mr-2 text-muted-foreground">{event.timestamp}</span>
                                        <span className="mr-2 uppercase">{event.kind}</span>
                                        <span>{event.details}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            <div className="flex-1 overflow-y-auto p-4">
                {chatItems.length === 0 ? (
                    <div className="flex h-full items-center justify-center">
                        <div className="text-center">
                            <p className="font-medium text-foreground">MCP Apps Chat</p>
                            <p className="mt-1 text-sm text-muted-foreground">Send a normal message and interact with MCP-UI inline.</p>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {chatItems.map((message) => (
                            <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[85%] rounded-lg px-4 py-3 ${
                                    message.role === 'user'
                                        ? 'bg-primary text-primary-foreground'
                                        : message.role === 'system'
                                            ? 'border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200'
                                            : 'border border-border bg-card text-foreground'
                                }`}>
                                    {message.role === 'assistant' ? (
                                        <div className="prose-sm dark:prose-invert prose prose-p:m-0 prose-li:m-0 prose-ul:m-0 prose-ol:m-0 max-w-full overflow-x-auto">
                                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                                                {message.text}
                                            </ReactMarkdown>
                                        </div>
                                    ) : (
                                        <p className="whitespace-pre-wrap break-words">{message.text}</p>
                                    )}

                                    {message.role === 'assistant' && message.resource && (
                                        <div className="mt-3 rounded border border-border p-2">
                                            <InlineMcpResource
                                                resource={message.resource}
                                                toolName={message.toolName}
                                                appResourceUri={message.appResourceUri}
                                                toolResult={message.toolResult}
                                                client={clientRef.current}
                                                sandboxUrl={sandboxUrl}
                                                onUiAction={handleUiAction}
                                                onAppToolCall={async (toolName, args) => {
                                                    const result = await executeTool({
                                                        toolName,
                                                        args,
                                                        kind: 'app',
                                                        userMessage: `[App] ${toolName}`,
                                                    });
                                                    if (!result) {
                                                        throw new Error(`Failed to run ${toolName}`);
                                                    }
                                                    return result;
                                                }}
                                                onRendererError={(msg) => appendEvent('error', msg)}
                                            />
                                        </div>
                                    )}

                                    {message.role === 'assistant' && message.nextActions && message.nextActions.length > 0 && (
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            {message.nextActions.map((action, idx) => (
                                                <button
                                                    key={`${message.id}_${idx}`}
                                                    onClick={() => {
                                                        void executeTool({
                                                            toolName: action.toolName,
                                                            args: action.params,
                                                            kind: 'tool',
                                                            userMessage: action.label,
                                                        });
                                                    }}
                                                    className="rounded-full border border-input px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
                                                    disabled={sending}
                                                >
                                                    {action.label}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        <div ref={messagesEndRef} />
                    </div>
                )}
            </div>

            <div className="border-t border-border p-4">
                <div className="mb-3 flex flex-wrap gap-2">
                    {quickPrompts.map((prompt) => (
                        <button
                            key={prompt}
                            onClick={() => void sendChat(prompt)}
                            disabled={sending}
                            className="rounded-full border border-input px-3 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                        >
                            {prompt}
                        </button>
                    ))}
                </div>

                <div className="flex gap-3">
                    <input
                        type="text"
                        value={input}
                        onChange={(event) => setInput(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault();
                                void sendChat();
                            }
                        }}
                        placeholder="Ask about projects, deploys, security, repo auth, or incidents..."
                        disabled={sending}
                        className="flex-1 rounded-lg border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                    />
                    <button
                        onClick={() => void sendChat()}
                        disabled={!input.trim() || sending}
                        className="rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                        {sending ? 'Sending...' : 'Send'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function InlineMcpResource({
    resource,
    toolName,
    appResourceUri,
    toolResult,
    client,
    sandboxUrl,
    onUiAction,
    onAppToolCall,
    onRendererError,
}: {
    resource: NormalizedUiResource;
    toolName?: string;
    appResourceUri?: string;
    toolResult?: CallToolResult;
    client: Client | null;
    sandboxUrl: URL;
    onUiAction: (action: { type: 'tool' | 'notify' | 'link' | 'prompt' | 'intent'; payload: any }) => Promise<void>;
    onAppToolCall: (toolName: string, args: Record<string, unknown>) => Promise<CallToolResult>;
    onRendererError: (message: string) => void;
}) {
    const [appFailed, setAppFailed] = useState(false);
    const shouldUseAppRenderer = isAppCompatible(resource) && !appFailed;

    if (shouldUseAppRenderer && client && toolName) {
        return (
            <div className="min-h-[220px]">
                <AppRenderer
                    client={client}
                    toolName={toolName}
                    toolResourceUri={appResourceUri}
                    sandbox={{ url: sandboxUrl }}
                    toolResult={toolResult}
                    onCallTool={async (params) => {
                        const args = params.arguments && typeof params.arguments === 'object'
                            ? (params.arguments as Record<string, unknown>)
                            : {};
                        return onAppToolCall(params.name, args);
                    }}
                    onError={(caught) => {
                        setAppFailed(true);
                        onRendererError(`AppRenderer failed: ${caught.message}. Falling back to UI renderer.`);
                    }}
                />
            </div>
        );
    }

    return (
        <UIResourceRenderer
            resource={resource}
            onUIAction={async (result) => {
                await onUiAction({
                    type: result.type,
                    payload: result.payload,
                });
            }}
        />
    );
}
