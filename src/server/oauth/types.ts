import { User } from '../../sdks/tableau/types/user.js';

export type Tokens = {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
};

export type PendingAuthorization = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  tableauState: string;
  tableauClientId: string;
  tableauCodeVerifier: string;
};

export type ClientCredentials = {
  clientId: string;
  server: string;
};

export type UserAndTokens = {
  user: User;
  clientId: string;
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
