import { getConfig } from '../../config';
import { Session } from './session';
import { SessionStoreFactory } from './sessionStoreFactory';
import { Store } from './store';

let sessionStore: Store<Session> | undefined;

export const getSessionStore = async (): Promise<Store<Session>> => {
  if (!sessionStore) {
    sessionStore = await SessionStoreFactory.create(getConfig().storage);
  }
  return sessionStore;
};
