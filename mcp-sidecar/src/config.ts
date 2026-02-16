import { z } from 'zod';

const schema = z.object({
  MCP_APPS_PORT: z.coerce.number().default(3232),
  MCP_APPS_HOST: z.string().default('127.0.0.1'),
  MCP_APPS_BASE_URL: z.string().default('http://127.0.0.1:3232'),
  MCP_ALLOWED_ORIGINS: z.string().default('http://127.0.0.1:8000,http://localhost:8000'),
  GITHUB_CLIENT_ID: z.string().default(''),
  GITHUB_CLIENT_SECRET: z.string().default(''),
  MCP_OAUTH_ENCRYPTION_KEY: z.string().default('local-dev-key-change-me'),
});

export type SidecarConfig = {
  port: number;
  host: string;
  baseUrl: string;
  allowedOrigins: Set<string>;
  githubClientId: string;
  githubClientSecret: string;
  oauthEncryptionKey: string;
};

export function loadConfig(env: NodeJS.ProcessEnv): SidecarConfig {
  const parsed = schema.parse(env);

  return {
    port: parsed.MCP_APPS_PORT,
    host: parsed.MCP_APPS_HOST,
    baseUrl: parsed.MCP_APPS_BASE_URL,
    allowedOrigins: new Set(
      parsed.MCP_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
    ),
    githubClientId: parsed.GITHUB_CLIENT_ID,
    githubClientSecret: parsed.GITHUB_CLIENT_SECRET,
    oauthEncryptionKey: parsed.MCP_OAUTH_ENCRYPTION_KEY,
  };
}
