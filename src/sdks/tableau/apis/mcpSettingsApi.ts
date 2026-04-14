import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { mcpSiteSettingsSchema } from '../types/mcpSiteSettings';

const getMcpSiteSettingsEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/settings/mcp',
  alias: 'getMcpSiteSettings',
  description: 'Returns the MCP settings overrides for a site.',
  response: z.object({ mcpSiteSettings: mcpSiteSettingsSchema }),
});

const mcpSettingsApi = makeApi([getMcpSiteSettingsEndpoint]);

export const mcpSettingsApis = [...mcpSettingsApi] as const satisfies ZodiosEndpointDefinitions;
