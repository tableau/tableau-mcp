import { getConfig } from '../../config';
import { DualLayerStore } from './dualLayerStore';
import { PersistentStoreFactory } from './persistentStoreFactory';
import { RedisSessionStore } from './redisSessionStore';
import { Session } from './session';

type SessionStore = DualLayerStore<Session>;
let sessionStore: SessionStore | undefined;

export const getSessionStore = async (): Promise<SessionStore> => {
  if (!sessionStore) {
    const { sessionPersistentStorage } = getConfig();
    sessionStore = new DualLayerStore(
      sessionPersistentStorage
        ? {
            persistentStore: await PersistentStoreFactory.create({
              config: sessionPersistentStorage,
              RedisStoreCtor: RedisSessionStore,
            }),
          }
        : undefined,
    );
  }
  return sessionStore;
};
