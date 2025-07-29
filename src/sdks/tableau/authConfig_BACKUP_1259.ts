export type AuthConfig = {
  siteName: string;
<<<<<<< HEAD
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
=======
  type: 'pat';
  patName: string;
  patValue: string;
};
>>>>>>> origin/anyoung/oauth
