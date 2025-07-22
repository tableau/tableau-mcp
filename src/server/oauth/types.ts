import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import express from 'express';

export type AuthenticatedRequest = express.Request & {
  auth?: AuthInfo;
};

export type Tokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export type PendingAuthorization = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string;
  scope: string;
  tableauState: string;
};

export type AuthorizationCode = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  userId: string;
  tokens: Tokens;
  expiresAt: number;
};

export type RefreshTokenData = {
  userId: string;
  clientId: string;
  tokens: Tokens;
  expiresAt: number;
};
