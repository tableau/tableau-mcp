import { getConfig } from '../../config';
import { DualLayerStore } from '../storage/dualLayerStore';
import { PersistentStoreFactory } from '../storage/persistentStoreFactory';
import { RedisStore } from '../storage/redisStore';
import { PendingAuthorization } from './types';

export type PendingAuthorizationStore = DualLayerStore<PendingAuthorization>;
let pendingAuthorizationStore: PendingAuthorizationStore | undefined;

export const getPendingAuthorizationStore = async (): Promise<PendingAuthorizationStore> => {
  if (!pendingAuthorizationStore) {
    const {
      oauth: { pendingAuthorizationPersistentStorage },
    } = getConfig();

    pendingAuthorizationStore = new DualLayerStore(
      pendingAuthorizationPersistentStorage
        ? {
            persistentStore: await PersistentStoreFactory.create({
              config: pendingAuthorizationPersistentStorage,
              RedisStoreCtor: RedisStore<PendingAuthorization>,
            }),
          }
        : undefined,
    );
  }
  return pendingAuthorizationStore;
};
