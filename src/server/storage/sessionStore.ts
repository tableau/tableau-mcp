import { getConfig } from '../../config';
import { InMemoryStore } from './inMemoryStore';
import { PersistentSessionStoreFactory } from './persistentSessionStoreFactory';
import { Session } from './session';
import { Store } from './store';

let sessionStore: SessionStore | undefined;

class SessionStore extends Store<Session> {
  private memoryStore: Store<Session>;
  private persistentStore: Store<Session> | undefined;

  constructor({ persistentStore }: { persistentStore?: Store<Session> } = {}) {
    super();
    this.memoryStore = new InMemoryStore<Session>();
    this.persistentStore = persistentStore;
  }

  async get(sessionId: string): Promise<Session | undefined> {
    const memoryStoreResult = await this.memoryStore.get(sessionId);
    if (memoryStoreResult) {
      return memoryStoreResult;
    }

    const persistentStoreResult = await this.persistentStore?.get(sessionId);
    if (persistentStoreResult) {
      await this.memoryStore.set(sessionId, persistentStoreResult);
      return persistentStoreResult;
    }
  }

  async set(sessionId: string, data: Session, expirationTimeMs?: number): Promise<this> {
    await this.memoryStore.set(sessionId, data, expirationTimeMs);
    await this.persistentStore?.set(sessionId, data, expirationTimeMs);
    return this;
  }

  async delete(sessionId: string): Promise<boolean> {
    const memoryStoreResult = await this.memoryStore.delete(sessionId);
    const persistentStoreResult = (await this.persistentStore?.delete(sessionId)) ?? true;
    return memoryStoreResult && persistentStoreResult;
  }

  async exists(sessionId: string): Promise<boolean> {
    return (
      (await this.memoryStore.exists(sessionId)) ??
      (await this.persistentStore?.exists(sessionId)) ??
      false
    );
  }

  async healthCheck(): Promise<boolean> {
    return (
      (await this.memoryStore.healthCheck()) &&
      ((await this.persistentStore?.healthCheck()) ?? true)
    );
  }

  async close(): Promise<void> {
    await this.memoryStore.close();
    await this.persistentStore?.close();
  }
}

export const getSessionStore = async (): Promise<SessionStore> => {
  if (!sessionStore) {
    const storageConfig = getConfig().storage;
    if (storageConfig) {
      sessionStore = new SessionStore({
        persistentStore: await PersistentSessionStoreFactory.create(storageConfig),
      });
    } else {
      sessionStore = new SessionStore();
    }
  }
  return sessionStore;
};
