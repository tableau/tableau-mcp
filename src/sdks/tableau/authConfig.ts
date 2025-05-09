export type AuthConfig = {
  siteName: string;
} & (
  | {
      type: 'username-password';
      username: string;
      password: string;
    }
  | {
      type: 'pat';
      patName: string;
      patValue: string;
    }
  | {
      type: 'jwt';
      jwt: string;
    }
  | {
      type: 'direct-trust';
      username: string;
      clientId: string;
      secretId: string;
      secretValue: string;
      scopes: string[];
    }
);
