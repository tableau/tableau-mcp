import { getConfig } from '../../config';
import { RedisStore } from '../storage/redisStore';
import { Store } from '../storage/store';
import { StoreFactory } from '../storage/storeFactory';
import { PendingAuthorization } from './types';

export type PendingAuthorizationStore = Store<PendingAuthorization>;
let pendingAuthorizationStore: PendingAuthorizationStore | undefined;

export const getPendingAuthorizationStore = async (): Promise<PendingAuthorizationStore> => {
  if (!pendingAuthorizationStore) {
    const {
      oauth: { pendingAuthorizationStorage },
    } = getConfig();

    pendingAuthorizationStore = await StoreFactory.create({
      config: pendingAuthorizationStorage,
      RedisStoreCtor: RedisStore<PendingAuthorization>,
    });
  }
  return pendingAuthorizationStore;
};
