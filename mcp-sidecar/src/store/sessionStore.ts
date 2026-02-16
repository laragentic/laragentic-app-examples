export type SessionRecord = {
  sessionId: string;
  createdAt: string;
  lastSeenAt: string;
};

export class SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  upsert(sessionId: string): SessionRecord {
    const now = new Date().toISOString();
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.lastSeenAt = now;
      this.sessions.set(sessionId, existing);
      return existing;
    }

    const created: SessionRecord = {
      sessionId,
      createdAt: now,
      lastSeenAt: now,
    };

    this.sessions.set(sessionId, created);
    return created;
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
