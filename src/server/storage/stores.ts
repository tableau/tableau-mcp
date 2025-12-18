import { KeyObject } from 'crypto';

import { getConfig } from '../../config';
import { AuthorizationCode, PendingAuthorization, RefreshTokenData } from '../oauth/types';
import { RedisSessionStore } from './redisSessionStore';
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
    RedisStoreCtor: RedisSessionStore,
  });

  return sessionStore;
}

export async function getAuthorizationCodeStore(
  privateKey: KeyObject,
): Promise<Store<AuthorizationCode>> {
  if (authorizationCodeStore) {
    return authorizationCodeStore;
  }

  const {
    oauth: { authzCodeStorage },
  } = getConfig();

  authorizationCodeStore = await StoreFactory.create({
    config: authzCodeStorage,
    privateKey,
  });

  return authorizationCodeStore;
}

export async function getRefreshTokenStore(
  privateKey: KeyObject,
): Promise<Store<RefreshTokenData>> {
  if (refreshTokenStore) {
    return refreshTokenStore;
  }

  const {
    oauth: { refreshTokenStorage },
  } = getConfig();

  refreshTokenStore = await StoreFactory.create({
    config: refreshTokenStorage,
    privateKey,
  });

  return refreshTokenStore;
}

export async function getPendingAuthorizationStore(
  privateKey: KeyObject,
): Promise<Store<PendingAuthorization>> {
  if (pendingAuthorizationStore) {
    return pendingAuthorizationStore;
  }

  const {
    oauth: { pendingAuthorizationStorage },
  } = getConfig();

  pendingAuthorizationStore = await StoreFactory.create({
    config: pendingAuthorizationStorage,
    privateKey,
  });

  return pendingAuthorizationStore;
}
