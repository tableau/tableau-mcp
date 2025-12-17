import { getConfig } from '../../config';
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
    });
  }
  return refreshTokenStore;
};
