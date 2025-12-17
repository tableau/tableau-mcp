import { getConfig } from '../../config';
import { Store } from '../storage/store';
import { StoreFactory } from '../storage/storeFactory';
import { AuthorizationCode } from './types';

export type AuthorizationCodeStore = Store<AuthorizationCode>;
let authorizationCodeStore: AuthorizationCodeStore | undefined;

export const getAuthorizationCodeStore = async (): Promise<AuthorizationCodeStore> => {
  if (!authorizationCodeStore) {
    const {
      oauth: { authzCodeStorage },
    } = getConfig();

    authorizationCodeStore = await StoreFactory.create({
      config: authzCodeStorage,
    });
  }
  return authorizationCodeStore;
};
