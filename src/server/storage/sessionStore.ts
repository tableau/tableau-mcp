import { getConfig } from '../../config';
import { RedisSessionStore } from './redisSessionStore';
import { Session } from './session';
import { Store } from './store';
import { StoreFactory } from './storeFactory';

type SessionStore = Store<Session>;
let sessionStore: SessionStore | undefined;

export const getSessionStore = async (): Promise<SessionStore> => {
  if (!sessionStore) {
    const { sessionStorage: sessionPersistentStorage } = getConfig();
    sessionStore = await StoreFactory.create({
      config: sessionPersistentStorage,
      RedisStoreCtor: RedisSessionStore,
    });
  }
  return sessionStore;
};
