import { getConfig } from '../../config';
import { DualLayerStore } from './dualLayerStore';
import { PersistentStoreFactory } from './persistentStoreFactory';
import { RedisSessionStore } from './redisSessionStore';
import { Session } from './session';

type SessionStore = DualLayerStore<Session>;
let sessionStore: SessionStore | undefined;

export const getSessionStore = async (): Promise<SessionStore> => {
  if (!sessionStore) {
    const { persistentStorage } = getConfig();
    sessionStore = new DualLayerStore(
      persistentStorage
        ? {
            persistentStore: await PersistentStoreFactory.create({
              config: persistentStorage,
              RedisStoreCtor: RedisSessionStore,
            }),
          }
        : undefined,
    );
  }
  return sessionStore;
};
