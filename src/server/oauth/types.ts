import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import express from 'express';

import { User } from '../../sdks/tableau/types/user.js';

export type AuthenticatedRequest = express.Request & {
  auth?: AuthInfo;
};

export type Tokens = {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
};

export type PendingAuthorization = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string;
  scope: string;
  tableauState: string;
  tableauClientId: string;
};

export type UserAndTokens = {
  user: User;
  server: string;
  tokens: Tokens;
};

export type AuthorizationCode = UserAndTokens & {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  expiresAt: number;
  tableauClientId: string;
};

export type RefreshTokenData = UserAndTokens & {
  clientId: string;
  expiresAt: number;
  tableauClientId: string;
};
