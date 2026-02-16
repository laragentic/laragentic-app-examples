import cookieParser from 'cookie-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { createUIResource, RESOURCE_URI_META_KEY } from '@mcp-ui/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import {
  buildGitHubAuthorizeUrl,
  exchangeGitHubCode,
  fetchGitHubUser,
  generateOAuthState,
} from './auth/githubOAuth.js';
import { loadConfig } from './config.js';
import { SessionStore } from './store/sessionStore.js';
import { TokenStore } from './store/tokenStore.js';

dotenv.config({ path: '../.env' });

const config = loadConfig(process.env);
const app = express();

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || config.allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin not allowed: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Mcp-Session-Id',
      'mcp-session-id',
      'Mcp-Protocol-Version',
      'mcp-protocol-version',
      'Last-Event-ID',
      'last-event-id',
      'Accept',
    ],
    exposedHeaders: ['Mcp-Session-Id', 'mcp-session-id', 'Mcp-Protocol-Version', 'mcp-protocol-version'],
  }),
);

const sessionStore = new SessionStore();
const tokenStore = new TokenStore();

type ServerSession = {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
};

const mcpSessions = new Map<string, ServerSession>();

const mockProjects = [
  {
    id: 'proj_a1b2c3d4',
    name: 'My API',
    template: 'api-only',
    status: 'active',
    environment: 'production',
    url: 'https://proj_a1b2c3d4.production.example.cloud',
    created_at: '2026-01-15T10:30:00Z',
  },
  {
    id: 'proj_e5f6g7h8',
    name: 'Frontend App',
    template: 'fullstack',
    status: 'deploying',
    environment: 'staging',
    url: 'https://proj_e5f6g7h8.staging.example.cloud',
    created_at: '2026-02-01T14:20:00Z',
  },
  {
    id: 'proj_i9j0k1l2',
    name: 'Auth Microservice',
    template: 'microservice',
    status: 'active',
    environment: 'production',
    url: 'https://proj_i9j0k1l2.production.example.cloud',
    created_at: '2026-02-10T09:15:00Z',
  },
];

function getRequestBaseUrl(req: Request): string {
  const forwardedProto = req.header('x-forwarded-proto');
  const forwardedHost = req.header('x-forwarded-host');

  const protocol =
    (forwardedProto ? forwardedProto.split(',')[0].trim() : req.protocol) || 'http';
  const host =
    (forwardedHost ? forwardedHost.split(',')[0].trim() : req.get('host')) ||
    new URL(config.baseUrl).host;

  return `${protocol}://${host}`;
}

function getToolUiUri(toolName: string): `ui://${string}` {
  return `ui://mcp-demo/apps/${toolName}`;
}

function createToolHtml(toolName: string): string {
  const contentByTool: Record<string, string> = {
    list_projects: `
      <p>This MCP App can trigger other MCP tools directly.</p>
      <button type="button" data-action="refresh">Refresh Projects</button>
      <button type="button" data-action="create-demo">Create Demo Project</button>
      <button type="button" data-action="deploy-first">Deploy First Project</button>
    `,
    create_project: `
      <p>Create a project from inside the AppRenderer iframe.</p>
      <form id="tool-form">
        <input name="name" placeholder="Project name" value="MCP UI App Project" />
        <select name="template">
          <option value="default">default</option>
          <option value="api-only">api-only</option>
          <option value="fullstack" selected>fullstack</option>
          <option value="microservice">microservice</option>
        </select>
        <button type="submit">Create Project</button>
      </form>
      <button type="button" data-action="list">List Projects</button>
    `,
    deploy_project: `
      <p>Deploy and chain actions from AppRenderer.</p>
      <form id="tool-form">
        <input name="project_id" placeholder="Project ID" value="proj_a1b2c3d4" />
        <select name="environment">
          <option value="staging" selected>staging</option>
          <option value="production">production</option>
          <option value="development">development</option>
        </select>
        <button type="submit">Deploy Project</button>
      </form>
      <button type="button" data-action="search">Open deployment docs</button>
    `,
    security_review: `
      <p>Run security review and continue to escalation.</p>
      <button type="button" data-action="run-review">Run Review</button>
      <button type="button" data-action="escalate">Create Escalation Plan</button>
    `,
    connect_repository: `
      <p>Simulate repo connection and open docs.</p>
      <button type="button" data-action="connect">Connect Repository</button>
      <button type="button" data-action="open-link">Open GitHub</button>
    `,
    incident_escalation: `
      <p>Create escalation then notify host.</p>
      <button type="button" data-action="run-escalation">Run Escalation</button>
      <button type="button" data-action="notify">Notify Host</button>
    `,
  };

  const body = contentByTool[toolName] ?? '<p>No custom app available for this tool.</p>';

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 16px; }
      .card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 12px; background: #fff; }
      h2 { margin: 0 0 8px 0; font-size: 16px; }
      p { margin: 0 0 10px 0; color: #374151; font-size: 14px; }
      button { border: 0; border-radius: 8px; background: #111827; color: #fff; padding: 8px 12px; cursor: pointer; margin-right: 8px; margin-top: 8px; }
      input, select { width: 100%; padding: 8px; margin: 6px 0; border: 1px solid #d1d5db; border-radius: 8px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h2>${toolName}</h2>
      <p>This is interactive MCP Apps UI rendered by AppRenderer.</p>
      ${body}
    </div>

    <script>
      const callTool = (toolName, params = {}) => {
        window.parent.postMessage({
          type: 'tool',
          payload: {
            toolName,
            params
          }
        }, '*');
      };

      const notify = (message) => {
        window.parent.postMessage({
          type: 'notify',
          payload: { message }
        }, '*');
      };

      const openLink = (url) => {
        window.parent.postMessage({
          type: 'link',
          payload: { url }
        }, '*');
      };

      const form = document.getElementById('tool-form');
      if (form) {
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          const formData = new FormData(form);
          const values = Object.fromEntries(formData.entries());
          callTool('${toolName}', values);
        });
      }

      document.addEventListener('click', (event) => {
        const target = event.target;
        if (!target || !(target instanceof HTMLElement)) return;
        const action = target.getAttribute('data-action');
        if (!action) return;

        if (action === 'refresh') callTool('list_projects', {});
        if (action === 'create-demo') callTool('create_project', { name: 'From AppRenderer', template: 'fullstack' });
        if (action === 'deploy-first') callTool('deploy_project', { project_id: 'proj_a1b2c3d4', environment: 'staging' });
        if (action === 'list') callTool('list_projects', {});
        if (action === 'search') openLink('https://docs.github.com/en/actions/deployment');
        if (action === 'run-review') callTool('security_review', { project_id: 'proj_a1b2c3d4', risk_level: 'medium' });
        if (action === 'escalate') callTool('incident_escalation', { service: 'api-gateway', severity: 'sev-2' });
        if (action === 'connect') callTool('connect_repository', { project_id: 'proj_e5f6g7h8', provider: 'github' });
        if (action === 'open-link') openLink('https://github.com/settings/connections/applications');
        if (action === 'run-escalation') callTool('incident_escalation', { service: 'api-gateway', severity: 'sev-2' });
        if (action === 'notify') notify('Escalation run was triggered from AppRenderer.');
      });
    </script>
  </body>
</html>`;
}

type UiAction = {
  label: string;
  toolName: string;
  params?: Record<string, unknown>;
};

function createUIResourceHtml(
  toolName: string,
  heading: string,
  body: string,
  actions: UiAction[] = [],
): ReturnType<typeof createUIResource> {
  const defaultActions: UiAction[] = [
    { label: 'List Projects', toolName: 'list_projects', params: {} },
    {
      label: 'Create Project',
      toolName: 'create_project',
      params: { name: 'From UIResource', template: 'api-only' },
    },
  ];

  const allActions = actions.length > 0 ? actions : defaultActions;
  const actionButtons = `
    <div style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap;">
      ${allActions
        .map((action) => {
          const payload = JSON.stringify({
            type: 'tool',
            payload: {
              toolName: action.toolName,
              params: action.params ?? {},
            },
          });
          return `<button onclick='window.parent.postMessage(${payload}, \"*\")' style="border:0;border-radius:8px;background:#111827;color:#fff;padding:8px 10px;cursor:pointer;">${action.label}</button>`;
        })
        .join('')}
      <button onclick="window.parent.postMessage({ type: 'notify', payload: { message: 'UIResource sent a host notification.' } }, '*')" style="border:0;border-radius:8px;background:#4b5563;color:#fff;padding:8px 10px;cursor:pointer;">Notify Host</button>
      <button onclick="window.parent.postMessage({ type: 'link', payload: { url: 'https://mcpui.dev/guide/client/overview' } }, '*')" style="border:0;border-radius:8px;background:#1d4ed8;color:#fff;padding:8px 10px;cursor:pointer;">Open MCP-UI Docs</button>
    </div>
  `;

  return createUIResource({
    uri: `ui://mcp-demo/resource/${toolName}/${Date.now()}`,
    content: {
      type: 'rawHtml',
      htmlString: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 12px; border: 1px solid #e5e7eb; border-radius: 10px;">
        <h3 style="margin:0 0 8px 0;">${heading}</h3>
        <p style="margin:0;">${body}</p>
        ${actionButtons}
      </div>
      `,
    },
    encoding: 'text',
  });
}

type ChatIntent =
  | 'list_projects'
  | 'create_project'
  | 'deploy_project'
  | 'security_review'
  | 'connect_repository'
  | 'incident_escalation'
  | 'unknown';

function inferChatIntent(message: string): ChatIntent {
  const lower = message.toLowerCase();
  if ((lower.includes('list') || lower.includes('show')) && lower.includes('project')) {
    return 'list_projects';
  }
  if (lower.includes('create') && lower.includes('project')) {
    return 'create_project';
  }
  if (lower.includes('deploy')) {
    return 'deploy_project';
  }
  if (lower.includes('security') || lower.includes('review')) {
    return 'security_review';
  }
  if (lower.includes('connect') && (lower.includes('repo') || lower.includes('github'))) {
    return 'connect_repository';
  }
  if (lower.includes('incident') || lower.includes('escalation')) {
    return 'incident_escalation';
  }
  return 'unknown';
}

function extractProjectId(message: string, fallback = 'proj_a1b2c3d4'): string {
  const match = message.match(/proj_[a-z0-9]+/i);
  return match?.[0] ?? fallback;
}

function extractEnvironment(message: string): 'staging' | 'production' | 'development' {
  const lower = message.toLowerCase();
  if (lower.includes('production')) return 'production';
  if (lower.includes('development')) return 'development';
  return 'staging';
}

function extractTemplate(message: string): 'default' | 'api-only' | 'fullstack' | 'microservice' {
  const lower = message.toLowerCase();
  if (lower.includes('api-only')) return 'api-only';
  if (lower.includes('microservice')) return 'microservice';
  if (lower.includes('fullstack')) return 'fullstack';
  return 'default';
}

function extractProjectName(message: string): string {
  const quoted = message.match(/(?:called|named)\s+["']([^"']+)["']/i);
  if (quoted?.[1]) {
    return quoted[1];
  }
  return 'MCP UI Demo Project';
}

function buildMcpServer(): McpServer {
  const server = new McpServer({
    name: 'laragentic-mcp-ui-sidecar',
    version: '1.0.0',
  });

  const appMime = 'text/html;profile=mcp-app';

  const registerAppResource = (toolName: string) => {
    const uri = getToolUiUri(toolName);

    server.registerResource(
      `${toolName}_ui`,
      uri,
      {
        title: `${toolName} app resource`,
        description: `AppRenderer resource for ${toolName}`,
        mimeType: appMime,
      },
      async () => ({
        contents: [
          {
            uri,
            mimeType: appMime,
            text: createToolHtml(toolName),
          },
        ],
      }),
    );
  };

  ['list_projects', 'create_project', 'deploy_project', 'security_review', 'connect_repository', 'incident_escalation'].forEach(
    registerAppResource,
  );

  server.registerTool(
    'chat_turn',
    {
      description: 'Chat-first MCP orchestration tool for the demo.',
      inputSchema: {
        message: z.string(),
        conversation_id: z.string().optional(),
      },
    },
    async (args) => {
      const intent = inferChatIntent(args.message);
      const conversationId = args.conversation_id ?? `conv_${randomUUID().slice(0, 8)}`;

      if (intent === 'list_projects') {
        const rows = mockProjects
          .map(
            (project) =>
              `| ${project.id} | ${project.name} | ${project.template} | ${project.status} | ${project.environment} |`,
          )
          .join('\n');

        const actions: UiAction[] = [
          { label: 'Create Project', toolName: 'create_project', params: { name: 'MCP UI Demo', template: 'fullstack' } },
          { label: 'Deploy First Project', toolName: 'deploy_project', params: { project_id: mockProjects[0].id, environment: 'staging' } },
          { label: 'Security Review', toolName: 'security_review', params: { project_id: mockProjects[0].id, risk_level: 'medium' } },
        ];

        return {
          content: [
            {
              type: 'text',
              text: `Here are your projects (${mockProjects.length} total):\n\n| Project ID | Name | Template | Status | Environment |\n| --- | --- | --- | --- | --- |\n${rows}\n\nChoose a next action below.`,
            },
            createUIResourceHtml('chat_turn', 'Projects Loaded', `Fetched ${mockProjects.length} projects.`, actions),
          ],
          _meta: {
            chat: {
              conversation_id: conversationId,
              intent,
              next_actions: actions.map((action) => ({
                label: action.label,
                toolName: action.toolName,
                params: action.params ?? {},
              })),
            },
          },
        };
      }

      if (intent === 'create_project') {
        const name = extractProjectName(args.message);
        const template = extractTemplate(args.message);
        const id = `proj_${Math.random().toString(16).slice(2, 10)}`;
        const actions: UiAction[] = [
          { label: 'List Projects', toolName: 'list_projects', params: {} },
          { label: 'Deploy This Project', toolName: 'deploy_project', params: { project_id: id, environment: 'staging' } },
        ];

        return {
          content: [
            {
              type: 'text',
              text: `Created project **${name}** (${template}) with id \`${id}\`.\n\nYou can deploy it now or go back to your full project list.`,
            },
            createUIResourceHtml('chat_turn', 'Project Created', `Created ${name} with id ${id}.`, actions),
          ],
          _meta: {
            chat: {
              conversation_id: conversationId,
              intent,
              next_actions: actions.map((action) => ({
                label: action.label,
                toolName: action.toolName,
                params: action.params ?? {},
              })),
            },
          },
        };
      }

      if (intent === 'deploy_project') {
        const projectId = extractProjectId(args.message);
        const environment = extractEnvironment(args.message);
        const actions: UiAction[] = [
          { label: 'Check Project List', toolName: 'list_projects', params: {} },
          { label: 'Run Security Review', toolName: 'security_review', params: { project_id: projectId, risk_level: 'medium' } },
          { label: 'Connect Repository', toolName: 'connect_repository', params: { project_id: projectId, provider: 'github' } },
        ];

        return {
          content: [
            {
              type: 'text',
              text: `Deployment requested for \`${projectId}\` to **${environment}**.\n\nUse the actions below to continue the workflow.`,
            },
            createUIResourceHtml(
              'chat_turn',
              'Deployment Started',
              `Project ${projectId} is deploying to ${environment}.`,
              actions,
            ),
          ],
          _meta: {
            chat: {
              conversation_id: conversationId,
              intent,
              next_actions: actions.map((action) => ({
                label: action.label,
                toolName: action.toolName,
                params: action.params ?? {},
              })),
            },
          },
        };
      }

      if (intent === 'security_review') {
        const projectId = extractProjectId(args.message);
        const actions: UiAction[] = [
          { label: 'Escalate Incident', toolName: 'incident_escalation', params: { service: 'api-gateway', severity: 'sev-2' } },
          { label: 'Deploy Project', toolName: 'deploy_project', params: { project_id: projectId, environment: 'staging' } },
        ];

        return {
          content: [
            {
              type: 'text',
              text: `Security review queued for \`${projectId}\`.\n\nSeverity checks and hardening recommendations are ready to apply.`,
            },
            createUIResourceHtml('chat_turn', 'Security Review', `Review started for ${projectId}.`, actions),
          ],
          _meta: {
            chat: {
              conversation_id: conversationId,
              intent,
              next_actions: actions.map((action) => ({
                label: action.label,
                toolName: action.toolName,
                params: action.params ?? {},
              })),
            },
          },
        };
      }

      if (intent === 'connect_repository') {
        const projectId = extractProjectId(args.message, 'proj_e5f6g7h8');
        const actions: UiAction[] = [
          { label: 'Connect GitHub', toolName: 'connect_repository', params: { project_id: projectId, provider: 'github' } },
          { label: 'Create Project', toolName: 'create_project', params: { name: 'Repo Connected App', template: 'fullstack' } },
        ];

        return {
          content: [
            {
              type: 'text',
              text: `Repository connection flow is ready for \`${projectId}\`.\n\nContinue with GitHub authorization or create a linked project.`,
            },
            createUIResourceHtml('chat_turn', 'Repository Access', `Repository setup ready for ${projectId}.`, actions),
          ],
          _meta: {
            chat: {
              conversation_id: conversationId,
              intent,
              next_actions: actions.map((action) => ({
                label: action.label,
                toolName: action.toolName,
                params: action.params ?? {},
              })),
            },
          },
        };
      }

      if (intent === 'incident_escalation') {
        const actions: UiAction[] = [
          { label: 'Run Escalation Plan', toolName: 'incident_escalation', params: { service: 'api-gateway', severity: 'sev-2' } },
          { label: 'Run Security Review', toolName: 'security_review', params: { project_id: 'proj_a1b2c3d4', risk_level: 'high' } },
        ];

        return {
          content: [
            {
              type: 'text',
              text: 'Incident escalation planning is available. Choose an action to generate the escalation workflow.',
            },
            createUIResourceHtml('chat_turn', 'Incident Escalation', 'Escalation actions are ready.', actions),
          ],
          _meta: {
            chat: {
              conversation_id: conversationId,
              intent,
              next_actions: actions.map((action) => ({
                label: action.label,
                toolName: action.toolName,
                params: action.params ?? {},
              })),
            },
          },
        };
      }

      const fallbackActions: UiAction[] = [
        { label: 'Show Projects', toolName: 'list_projects', params: {} },
        { label: 'Create Project', toolName: 'create_project', params: { name: 'Starter Project', template: 'fullstack' } },
        { label: 'Deploy Project', toolName: 'deploy_project', params: { project_id: 'proj_a1b2c3d4', environment: 'staging' } },
      ];

      return {
        content: [
          {
            type: 'text',
            text: `I can help with project operations. Try one of these:\n- list projects\n- create a project\n- deploy a project\n- run security review\n- connect repository\n- incident escalation`,
          },
          createUIResourceHtml('chat_turn', 'Try a Guided Action', 'Pick a common workflow to continue.', fallbackActions),
        ],
        _meta: {
          chat: {
            conversation_id: conversationId,
            intent: 'unknown',
            next_actions: fallbackActions.map((action) => ({
              label: action.label,
              toolName: action.toolName,
              params: action.params ?? {},
            })),
          },
        },
      };
    },
  );

  server.registerTool(
    'list_projects',
    {
      description: 'List all demo projects',
      _meta: { [RESOURCE_URI_META_KEY]: getToolUiUri('list_projects') },
    },
    async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ total: mockProjects.length, projects: mockProjects }, null, 2),
        },
        createUIResourceHtml('list_projects', 'Projects Loaded', `Fetched ${mockProjects.length} projects from MCP sidecar.`),
      ],
    }),
  );

  server.registerTool(
    'create_project',
    {
      description: 'Create a project',
      _meta: { [RESOURCE_URI_META_KEY]: getToolUiUri('create_project') },
      inputSchema: {
        name: z.string(),
        template: z.string().optional(),
      },
    },
    async (args) => {
      const id = `proj_${Math.random().toString(16).slice(2, 10)}`;
      return {
        content: [
          {
            type: 'text',
            text: `Created project ${args.name} (${args.template ?? 'default'}) with id ${id}.`,
          },
          createUIResourceHtml('create_project', 'Project Created', `Created ${args.name} with id ${id}.`),
        ],
      };
    },
  );

  server.registerTool(
    'deploy_project',
    {
      description: 'Deploy a project',
      _meta: { [RESOURCE_URI_META_KEY]: getToolUiUri('deploy_project') },
      inputSchema: {
        project_id: z.string(),
        environment: z.string().default('staging'),
      },
    },
    async (args) => ({
      content: [
        {
          type: 'text',
          text: `Deployment requested for ${args.project_id} to ${args.environment}.`,
        },
        createUIResourceHtml(
          'deploy_project',
          'Deployment Started',
          `Project ${args.project_id} is deploying to ${args.environment}.`,
        ),
      ],
    }),
  );

  server.registerTool(
    'security_review',
    {
      description: 'Run security review elicitation',
      _meta: { [RESOURCE_URI_META_KEY]: getToolUiUri('security_review') },
      inputSchema: {
        project_id: z.string(),
        risk_level: z.enum(['low', 'medium', 'high', 'critical']).optional(),
      },
    },
    async (args) => ({
      content: [
        {
          type: 'text',
          text: `Security review completed for ${args.project_id} at risk level ${args.risk_level ?? 'medium'}.`,
        },
        createUIResourceHtml(
          'security_review',
          'Security Review',
          `Risk level set to ${args.risk_level ?? 'medium'} for ${args.project_id}.`,
        ),
      ],
    }),
  );

  server.registerTool(
    'connect_repository',
    {
      description: 'Connect project repository',
      _meta: { [RESOURCE_URI_META_KEY]: getToolUiUri('connect_repository') },
      inputSchema: {
        project_id: z.string(),
        provider: z.string().default('github'),
      },
    },
    async (args) => ({
      content: [
        {
          type: 'text',
          text: `Repository connected for ${args.project_id} via ${args.provider}.`,
        },
        createUIResourceHtml(
          'connect_repository',
          'Repository Connected',
          `Connected ${args.project_id} to ${args.provider}.`,
        ),
      ],
    }),
  );

  server.registerTool(
    'incident_escalation',
    {
      description: 'Create incident escalation plan',
      _meta: { [RESOURCE_URI_META_KEY]: getToolUiUri('incident_escalation') },
      inputSchema: {
        service: z.string(),
        severity: z.enum(['sev-1', 'sev-2', 'sev-3', 'sev-4']).optional(),
      },
    },
    async (args) => ({
      content: [
        {
          type: 'text',
          text: `Escalation plan ready for ${args.service} (${args.severity ?? 'sev-3'}).`,
        },
        createUIResourceHtml(
          'incident_escalation',
          'Escalation Plan Ready',
          `Service ${args.service} configured at ${args.severity ?? 'sev-3'}.`,
        ),
      ],
    }),
  );

  return server;
}

function getSessionId(req: Request): string | undefined {
  const raw = req.header('mcp-session-id') ?? req.header('Mcp-Session-Id');
  return raw?.trim() || undefined;
}

function isInitializeRequest(body: unknown): boolean {
  if (!body || typeof body !== 'object') {
    return false;
  }

  if (Array.isArray(body)) {
    return body.some((item) => item && typeof item === 'object' && 'method' in item && (item as { method?: string }).method === 'initialize');
  }

  return 'method' in body && (body as { method?: string }).method === 'initialize';
}

function getAuthenticatedTokenId(req: Request): string | undefined {
  const tokenId = req.cookies?.mcp_auth_token as string | undefined;
  if (!tokenId) {
    return undefined;
  }

  if (!tokenStore.get(tokenId)) {
    return undefined;
  }

  return tokenId;
}

app.get('/oauth/authorize', (req, res) => {
  if (!config.githubClientId || !config.githubClientSecret) {
    res.status(500).json({ error: 'GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.' });
    return;
  }

  const state = generateOAuthState();
  const returnTo = typeof req.query.return_to === 'string' ? req.query.return_to : '';
  const requestBaseUrl = getRequestBaseUrl(req);
  const redirectUri = `${requestBaseUrl}/oauth/callback/github`;

  res.cookie('mcp_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 10 * 60 * 1000,
  });

  if (returnTo) {
    res.cookie('mcp_oauth_return_to', returnTo, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: 10 * 60 * 1000,
    });
  }

  res.cookie('mcp_oauth_redirect_uri', redirectUri, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 10 * 60 * 1000,
  });

  const authorizeUrl = buildGitHubAuthorizeUrl({
    clientId: config.githubClientId,
    redirectUri,
    state,
    scope: 'read:user user:email',
  });

  res.redirect(authorizeUrl);
});

app.get('/oauth/callback/github', async (req, res) => {
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const expectedState = req.cookies?.mcp_oauth_state as string | undefined;
  const returnTo = (req.cookies?.mcp_oauth_return_to as string | undefined) ?? '';
  const redirectUriCookie = req.cookies?.mcp_oauth_redirect_uri as string | undefined;

  if (!state || !code || !expectedState || state !== expectedState) {
    res.status(400).send('OAuth state mismatch or missing code.');
    return;
  }

  try {
    const redirectUri = redirectUriCookie ?? `${getRequestBaseUrl(req)}/oauth/callback/github`;
    const token = await exchangeGitHubCode({
      clientId: config.githubClientId,
      clientSecret: config.githubClientSecret,
      code,
      redirectUri,
    });

    const user = await fetchGitHubUser(token.access_token);
    const tokenId = randomUUID();

    tokenStore.set({
      tokenId,
      accessToken: token.access_token,
      tokenType: token.token_type,
      scope: token.scope,
      userId: user.id,
      userLogin: user.login,
      createdAt: new Date().toISOString(),
    });

    res.clearCookie('mcp_oauth_state');
    res.clearCookie('mcp_oauth_return_to');
    res.clearCookie('mcp_oauth_redirect_uri');

    res.cookie('mcp_auth_token', tokenId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: 12 * 60 * 60 * 1000,
    });

    const safeReturnUrl = returnTo && /^https?:\/\//.test(returnTo) ? returnTo : `${config.allowedOrigins.values().next().value ?? 'http://127.0.0.1:8000'}/tutorial/mcp-chat`;

    res.status(200).send(`<!doctype html><html><body><script>
      if (window.opener) {
        window.opener.postMessage({ type: 'mcp-oauth-complete' }, '*');
        window.close();
      } else {
        window.location.href = ${JSON.stringify(safeReturnUrl)};
      }
    </script>Authentication complete.</body></html>`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OAuth callback failed';
    res.status(500).send(message);
  }
});

app.post('/oauth/token', async (req, res) => {
  const bodySchema = z.object({
    code: z.string(),
    redirect_uri: z.string().url().optional(),
  });
  const parsed = bodySchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid OAuth token request payload.' });
    return;
  }

  try {
    const redirectUri =
      parsed.data.redirect_uri ?? `${getRequestBaseUrl(req)}/oauth/callback/github`;
    const token = await exchangeGitHubCode({
      clientId: config.githubClientId,
      clientSecret: config.githubClientSecret,
      code: parsed.data.code,
      redirectUri,
    });

    res.json(token);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OAuth token exchange failed';
    res.status(500).json({ error: message });
  }
});

app.get('/.well-known/oauth-authorization-server', (req, res) => {
  const requestBaseUrl = getRequestBaseUrl(req);
  res.json({
    issuer: requestBaseUrl,
    authorization_endpoint: `${requestBaseUrl}/oauth/authorize`,
    token_endpoint: `${requestBaseUrl}/oauth/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    token_endpoint_auth_methods_supported: ['client_secret_post'],
  });
});

app.get('/oauth/session', (req, res) => {
  const tokenId = getAuthenticatedTokenId(req);
  if (!tokenId) {
    res.status(200).json({ authenticated: false });
    return;
  }

  const token = tokenStore.get(tokenId);
  res.status(200).json({
    authenticated: true,
    user: {
      id: token?.userId,
      login: token?.userLogin,
    },
  });
});

app.get('/sandbox_proxy.html', (_req, res) => {
  res.type('text/html').send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body, iframe { width: 100%; height: 100%; margin: 0; border: 0; }
      body { overflow: hidden; }
    </style>
  </head>
  <body>
    <iframe id="guest" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>
    <script>
      const guest = document.getElementById('guest');
      window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/sandbox-proxy-ready', params: {} }, '*');

      window.addEventListener('message', (event) => {
        const message = event.data;

        if (!message || typeof message !== 'object') {
          return;
        }

        if (event.source === guest.contentWindow) {
          window.parent.postMessage(message, '*');
          return;
        }

        if (message.method === 'ui/notifications/sandbox-resource-ready' && message.params && typeof message.params.html === 'string') {
          guest.srcdoc = message.params.html;
          return;
        }

        if (guest.contentWindow) {
          guest.contentWindow.postMessage(message, '*');
        }
      });
    </script>
  </body>
</html>`);
});

app.all('/mcp', async (req, res) => {
  const origin = req.headers.origin;
  if (origin && !config.allowedOrigins.has(origin)) {
    res.status(403).json({ error: 'Forbidden origin.' });
    return;
  }

  const tokenId = getAuthenticatedTokenId(req);
  if (!tokenId) {
    const requestBaseUrl = getRequestBaseUrl(req);
    res.status(401).json({
      error: 'Unauthorized',
      authorization_url: `${requestBaseUrl}/oauth/authorize?return_to=${encodeURIComponent(`${config.allowedOrigins.values().next().value ?? 'http://127.0.0.1:8000'}/tutorial/mcp-chat`)}`,
    });
    return;
  }

  const sessionId = getSessionId(req);

  if (req.method === 'POST') {
    const initializationRequest = isInitializeRequest(req.body);

    if (!sessionId && !initializationRequest) {
      res.status(400).json({ error: 'Missing Mcp-Session-Id for non-initialize request.' });
      return;
    }

    if (!sessionId && initializationRequest) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });

      const server = buildMcpServer();
      await server.connect(transport);

      await transport.handleRequest(req, res, req.body);

      if (transport.sessionId) {
        mcpSessions.set(transport.sessionId, { transport, server });
        sessionStore.upsert(transport.sessionId);
      }

      return;
    }

    const existing = sessionId ? mcpSessions.get(sessionId) : undefined;
    if (!existing) {
      res.status(404).json({ error: 'Unknown MCP session.' });
      return;
    }

    sessionStore.upsert(sessionId!);
    await existing.transport.handleRequest(req, res, req.body);
    return;
  }

  if (req.method === 'GET') {
    if (!sessionId) {
      // SDK expects 405 when standalone GET SSE isn't offered.
      res.status(405).json({ error: 'Standalone GET stream is not supported without Mcp-Session-Id.' });
      return;
    }

    const existing = mcpSessions.get(sessionId);
    if (!existing) {
      res.status(404).json({ error: 'Unknown MCP session.' });
      return;
    }

    sessionStore.upsert(sessionId);
    await existing.transport.handleRequest(req, res);
    return;
  }

  if (req.method === 'DELETE') {
    if (!sessionId) {
      res.status(400).json({ error: 'Missing Mcp-Session-Id header for DELETE.' });
      return;
    }

    const existing = mcpSessions.get(sessionId);
    if (!existing) {
      res.status(404).json({ error: 'Unknown MCP session.' });
      return;
    }

    await existing.transport.handleRequest(req, res);
    await existing.server.close();
    mcpSessions.delete(sessionId);
    sessionStore.delete(sessionId);
    return;
  }

  res.status(405).json({ error: `Method ${req.method} not allowed.` });
});

app.listen(config.port, config.host, () => {
  console.log(`[mcp-sidecar] listening on http://${config.host}:${config.port}`);
});
