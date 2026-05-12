import { z } from 'zod';

import { log } from '../../logging/logger.js';

const tokenInfoResponseSchema = z.object({
  aud: z.string(),
  email: z.string().email(),
  email_verified: z
    .string()
    .transform((v) => v === 'true')
    .pipe(z.literal(true)),
  expires_in: z.coerce.number().int().positive(),
  hd: z.string().optional(),
  scope: z.string().optional(),
});

export type TokenInfoResponse = z.infer<typeof tokenInfoResponseSchema>;

export class GoogleTokenInfoClient {
  private readonly tokeninfoUrl: string;
  private readonly timeoutMs: number;

  constructor({
    tokeninfoUrl = 'https://oauth2.googleapis.com/tokeninfo',
    timeoutMs = 5000,
  }: {
    tokeninfoUrl?: string;
    timeoutMs?: number;
  } = {}) {
    this.tokeninfoUrl = tokeninfoUrl;
    this.timeoutMs = timeoutMs;
  }

  async validate(accessToken: string): Promise<TokenInfoResponse> {
    const url = `${this.tokeninfoUrl}?access_token=${encodeURIComponent(accessToken)}`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      log({
        message: `Google tokeninfo request failed: ${response.status} ${body}`,
        level: 'debug',
        logger: 'oauth',
      });
      throw new Error(`Google tokeninfo returned ${response.status}`);
    }

    const json: unknown = await response.json();
    const parsed = tokenInfoResponseSchema.safeParse(json);

    if (!parsed.success) {
      throw new Error(`Invalid tokeninfo response: ${parsed.error.message}`);
    }

    return parsed.data;
  }
}
