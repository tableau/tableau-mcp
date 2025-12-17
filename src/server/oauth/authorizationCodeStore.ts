import { getConfig } from '../../config';
import { DualLayerStore } from '../storage/dualLayerStore';
import { PersistentStoreFactory } from '../storage/persistentStoreFactory';
import { RedisStore } from '../storage/redisStore';
import { AuthorizationCode } from './types';

export type AuthorizationCodeStore = DualLayerStore<AuthorizationCode>;
let authorizationCodeStore: AuthorizationCodeStore | undefined;

export const getAuthorizationCodeStore = async (): Promise<AuthorizationCodeStore> => {
  if (!authorizationCodeStore) {
    const {
      oauth: { authzCodePersistentStorage },
    } = getConfig();

    authorizationCodeStore = new DualLayerStore(
      authzCodePersistentStorage
        ? {
            persistentStore: await PersistentStoreFactory.create({
              config: authzCodePersistentStorage,
              RedisStoreCtor: RedisStore<AuthorizationCode>,
            }),
          }
        : undefined,
    );
  }
  return authorizationCodeStore;
};
