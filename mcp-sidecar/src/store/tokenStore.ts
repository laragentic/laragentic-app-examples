export type OAuthTokenRecord = {
  tokenId: string;
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  userLogin?: string;
  userId?: number;
  expiresAt?: number;
  createdAt: string;
};

export class TokenStore {
  private readonly tokens = new Map<string, OAuthTokenRecord>();

  set(record: OAuthTokenRecord): void {
    this.tokens.set(record.tokenId, record);
  }

  get(tokenId: string): OAuthTokenRecord | undefined {
    return this.tokens.get(tokenId);
  }

  delete(tokenId: string): void {
    this.tokens.delete(tokenId);
  }
}
