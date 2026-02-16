# MCP Sidecar (MCP Apps + MCP-UI)

This service provides a local MCP Apps endpoint for the Laravel demo app.

## Endpoints

- `POST /mcp` - JSON-RPC MCP requests over Streamable HTTP
- `GET /mcp` - MCP stream endpoint (requires `Mcp-Session-Id`)
- `DELETE /mcp` - Session termination
- `GET /oauth/authorize` - Start GitHub OAuth flow
- `GET /oauth/callback/github` - OAuth callback
- `POST /oauth/token` - OAuth code exchange endpoint
- `GET /.well-known/oauth-authorization-server` - OAuth metadata
- `GET /oauth/session` - Current auth status for UI
- `GET /sandbox_proxy.html` - Sandbox proxy page used by AppRenderer

## Run

```bash
npm --prefix mcp-sidecar install
npm run dev:mcp
```

## Required env vars

- `MCP_APPS_BASE_URL`
- `MCP_ALLOWED_ORIGINS`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `MCP_OAUTH_ENCRYPTION_KEY`

## Notes

- The sidecar stores sessions/tokens in-memory for tutorial use.
- Keep this on localhost for development; do not use current defaults for production.
