import { AnalysisSession, createAnalysisSession } from './analysisSession.js';

// In-memory store (prototype - not production-ready for multi-tenant use)
const analysisSessions: Map<string, AnalysisSession> = new Map();

export const analysisSessionStore = {
    create(name?: string): AnalysisSession {
        const session = createAnalysisSession(name);
        analysisSessions.set(session.sessionId, session);
        return session;
    },

    // Pure getter - does not mutate state
    get(sessionId: string): AnalysisSession | undefined {
        return analysisSessions.get(sessionId);
    },

    // Check if session is expired
    isExpired(session: AnalysisSession): boolean {
        const elapsed = Date.now() - new Date(session.lastActivityAt).getTime();
        return elapsed > session.ttlMs;
    },

    // Get session if valid (not expired), returns undefined if expired or not found
    getIfValid(sessionId: string): AnalysisSession | undefined {
        const session = this.get(sessionId);
        if (!session) return undefined;
        if (this.isExpired(session)) {
            this.delete(sessionId);
            return undefined;
        }
        return session;
    },

    // Explicitly update last activity time
    touch(sessionId: string): void {
        const session = this.get(sessionId);
        if (session) {
            session.lastActivityAt = new Date().toISOString();
        }
    },

    update(sessionId: string, updates: Partial<AnalysisSession>): AnalysisSession | undefined {
        const session = this.getIfValid(sessionId);
        if (!session) return undefined;

        Object.assign(session, updates, { lastActivityAt: new Date().toISOString() });
        return session;
    },

    delete(sessionId: string): boolean {
        return analysisSessions.delete(sessionId);
    },

    list(): AnalysisSession[] {
        // Clean up expired sessions during list
        this.cleanupExpired();
        return Array.from(analysisSessions.values());
    },

    // Periodic cleanup of expired sessions
    cleanupExpired(): void {
        for (const [id, session] of analysisSessions) {
            if (this.isExpired(session)) {
                analysisSessions.delete(id);
            }
        }
    },

    // For testing: clear all sessions
    clear(): void {
        analysisSessions.clear();
    },
};
