import { getConfig } from '../../config';
import { DualLayerStore } from './dualLayerStore';
import { PersistentSessionStoreFactory } from './persistentSessionStoreFactory';
import { Session } from './session';

type SessionStore = DualLayerStore<Session>;
let sessionStore: SessionStore | undefined;

export const getSessionStore = async (): Promise<SessionStore> => {
  if (!sessionStore) {
    const storageConfig = getConfig().storage;
    if (storageConfig) {
      sessionStore = new DualLayerStore({
        persistentStore: await PersistentSessionStoreFactory.create(storageConfig),
      });
    } else {
      sessionStore = new DualLayerStore();
    }
  }
  return sessionStore;
};
