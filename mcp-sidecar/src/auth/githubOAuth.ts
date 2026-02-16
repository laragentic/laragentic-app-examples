import crypto from 'node:crypto';

export type GitHubTokenResponse = {
  access_token: string;
  token_type?: string;
  scope?: string;
};

export type GitHubUserResponse = {
  id: number;
  login: string;
};

export function generateOAuthState(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function buildGitHubAuthorizeUrl(options: {
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: string;
}): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    state: options.state,
    scope: options.scope ?? 'read:user',
  });

  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export async function exchangeGitHubCode(options: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<GitHubTokenResponse> {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: options.clientId,
      client_secret: options.clientSecret,
      code: options.code,
      redirect_uri: options.redirectUri,
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub token exchange failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as Partial<GitHubTokenResponse> & {
    error?: string;
    error_description?: string;
  };

  if (payload.error || !payload.access_token) {
    throw new Error(payload.error_description ?? payload.error ?? 'GitHub token exchange returned no access token');
  }

  return {
    access_token: payload.access_token,
    token_type: payload.token_type,
    scope: payload.scope,
  };
}

export async function fetchGitHubUser(accessToken: string): Promise<GitHubUserResponse> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub user fetch failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as Partial<GitHubUserResponse>;

  if (typeof payload.id !== 'number' || typeof payload.login !== 'string') {
    throw new Error('GitHub user payload is invalid');
  }

  return {
    id: payload.id,
    login: payload.login,
  };
}
