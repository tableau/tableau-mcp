export type AuthConfig =
  | {
      siteName: string;
      type: 'pat';
      patName: string;
      patValue: string;
    }
  | {
      type: 'accessToken';
      accessToken: string;
    };
