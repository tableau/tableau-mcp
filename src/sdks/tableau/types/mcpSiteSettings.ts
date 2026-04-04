import { z } from 'zod';

export const mcpSiteSettingsSchema = z.object({
  settings: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
    }),
  ),
});

export type McpSiteSettingsResult = z.infer<typeof mcpSiteSettingsSchema>;
export type McpSiteSettings = Record<string, string>;
