import { z } from 'zod';

export const mcpSiteSettingsSchema = z.record(z.string(), z.string());
export type McpSiteSettings = z.infer<typeof mcpSiteSettingsSchema>;
