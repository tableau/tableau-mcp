export type AuthConfig = {
  siteName: string;
} & (
  | {
      type: 'pat';
      patName: string;
      patValue: string;
    }
  | {
      type: 'direct-trust';
      username: string;
      clientId: string;
      secretId: string;
      secretValue: string;
      scopes: Set<string>;
      additionalPayload?: Record<string, unknown>;
    }
);
