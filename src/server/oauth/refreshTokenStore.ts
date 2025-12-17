import { getConfig } from '../../config';
import { DualLayerStore } from '../storage/dualLayerStore';
import { PersistentStoreFactory } from '../storage/persistentStoreFactory';
import { RedisStore } from '../storage/redisStore';
import { RefreshTokenData } from './types';

export type RefreshTokenStore = DualLayerStore<RefreshTokenData>;
let refreshTokenStore: RefreshTokenStore | undefined;

export const getRefreshTokenStore = async (): Promise<RefreshTokenStore> => {
  if (!refreshTokenStore) {
    const {
      oauth: { refreshTokenPersistentStorage },
    } = getConfig();

    refreshTokenStore = new DualLayerStore(
      refreshTokenPersistentStorage
        ? {
            persistentStore: await PersistentStoreFactory.create({
              config: refreshTokenPersistentStorage,
              RedisStoreCtor: RedisStore<RefreshTokenData>,
            }),
          }
        : undefined,
    );
  }
  return refreshTokenStore;
};
