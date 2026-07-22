import { z } from 'zod';

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

  constructor({ pid, port, secret, start_time }: DesktopInstanceMetadata) {
    this.pid = pid;
    this.port = port;
    this.secret = secret;
    this.start_time = start_time;
  }
}
