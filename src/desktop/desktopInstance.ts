import { z } from 'zod';

import { getAgentApiClient } from './getAgentApiClient.js';

export const desktopInstanceMetadataSchema = z.object({
  pid: z.number(),
  port: z.number(),
  secret: z.string(),
  start_time: z.string(),
});

export type DesktopInstanceMetadata = z.infer<typeof desktopInstanceMetadataSchema>;

export class DesktopInstance {
  readonly pid: number;
  readonly port: number;
  readonly secret: string;
  readonly start_time: string;
  readonly signal: AbortSignal;

  constructor({
    pid,
    port,
    secret,
    start_time,
    signal,
  }: DesktopInstanceMetadata & { signal: AbortSignal }) {
    this.pid = pid;
    this.port = port;
    this.secret = secret;
    this.start_time = start_time;
    this.signal = signal;
  }

  async isAlive(): Promise<boolean> {
    const client = await getAgentApiClient({
      signal: this.signal,
      config: {
        agentApiBase: `http://127.0.0.1:${this.port}/api/v1`,
      },
    });

    return await client.getHealth();
  }
}
