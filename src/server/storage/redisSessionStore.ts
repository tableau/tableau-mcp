import { RedisStore } from './redisStore';
import { Session } from './session';

export class RedisSessionStore extends RedisStore<Session> {
  async set(sessionId: string, data: Session, expirationTimeMs: number): Promise<this> {
    // Remove the transport from the session data to avoid serializing it
    return await super.set(
      sessionId,
      {
        ...data,
        transport: undefined,
      },
      expirationTimeMs,
    );
  }
}
