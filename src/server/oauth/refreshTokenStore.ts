import { getConfig } from '../../config';
import { RedisStore } from '../storage/redisStore';
import { Store } from '../storage/store';
import { StoreFactory } from '../storage/storeFactory';
import { RefreshTokenData } from './types';

export type RefreshTokenStore = Store<RefreshTokenData>;
let refreshTokenStore: RefreshTokenStore | undefined;

export const getRefreshTokenStore = async (): Promise<RefreshTokenStore> => {
  if (!refreshTokenStore) {
    const {
      oauth: { refreshTokenStorage: refreshTokenPersistentStorage },
    } = getConfig();

    refreshTokenStore = await StoreFactory.create({
      config: refreshTokenPersistentStorage,
      RedisStoreCtor: RedisStore<RefreshTokenData>,
    });
  }
  return refreshTokenStore;
};
