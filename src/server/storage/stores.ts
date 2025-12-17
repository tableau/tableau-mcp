import { getConfig } from '../../config';
import { AuthorizationCode, PendingAuthorization, RefreshTokenData } from '../oauth/types';
import { Session } from './session';
import { Store } from './store';
import { StoreFactory } from './storeFactory';

let sessionStore: Store<Session> | undefined;
let authorizationCodeStore: Store<AuthorizationCode> | undefined;
let refreshTokenStore: Store<RefreshTokenData> | undefined;
let pendingAuthorizationStore: Store<PendingAuthorization> | undefined;

export async function getSessionStore(): Promise<Store<Session>> {
  if (sessionStore) {
    return sessionStore;
  }

  const { sessionStorage: sessionPersistentStorage } = getConfig();
  sessionStore = await StoreFactory.create({
    config: sessionPersistentStorage,
  });

  return sessionStore;
}

export async function getAuthorizationCodeStore(): Promise<Store<AuthorizationCode>> {
  if (authorizationCodeStore) {
    return authorizationCodeStore;
  }

  const {
    oauth: { authzCodeStorage },
  } = getConfig();

  authorizationCodeStore = await StoreFactory.create({
    config: authzCodeStorage,
  });

  return authorizationCodeStore;
}

export async function getRefreshTokenStore(): Promise<Store<RefreshTokenData>> {
  if (refreshTokenStore) {
    return refreshTokenStore;
  }

  const {
    oauth: { refreshTokenStorage },
  } = getConfig();

  refreshTokenStore = await StoreFactory.create({
    config: refreshTokenStorage,
  });

  return refreshTokenStore;
}

export async function getPendingAuthorizationStore(): Promise<Store<PendingAuthorization>> {
  if (pendingAuthorizationStore) {
    return pendingAuthorizationStore;
  }

  const {
    oauth: { pendingAuthorizationStorage },
  } = getConfig();

  pendingAuthorizationStore = await StoreFactory.create({
    config: pendingAuthorizationStorage,
  });

  return pendingAuthorizationStore;
}
