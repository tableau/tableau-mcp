import { z } from 'zod';

export const mcpSiteSettingsSchema = z.object({
  settings: z
    .array(
      z.object({
        key: z.string().max(100),
        value: z.string().max(1000),
      }),
    )
    .max(100),
});

export type McpSiteSettingsResult = z.infer<typeof mcpSiteSettingsSchema>;
export type McpSiteSettings = Record<string, string>;
