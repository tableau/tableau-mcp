import { z } from 'zod';

// Query Workbook Permissions response (rest_api_ref_permissions.htm#query_workbook_permissions).
// Fields are kept defensively optional - following workbookConnectionSchema - because Tableau
// Server/Cloud versions vary in what they emit and omit empty collections, so one odd grantee
// should not fail the whole parse. `mode` is 'Allow'/'Deny' but stays a string for forward-compat.
const capabilitySchema = z.object({
  name: z.string(),
  mode: z.string(),
});

export const granteeCapabilitySchema = z.object({
  user: z.object({ id: z.string(), name: z.string().optional() }).optional(),
  group: z.object({ id: z.string(), name: z.string().optional() }).optional(),
  capabilities: z.object({ capability: z.array(capabilitySchema).optional() }).optional(),
});

export const workbookPermissionsSchema = z.object({
  permissions: z.object({
    workbook: z.object({ id: z.string().optional(), name: z.string().optional() }).optional(),
    granteeCapabilities: z.array(granteeCapabilitySchema).optional(),
  }),
});

// Query Data Source Permissions response (rest_api_ref_permissions.htm#query_data_source_permissions).
export const datasourcePermissionsSchema = z.object({
  permissions: z.object({
    datasource: z.object({ id: z.string().optional(), name: z.string().optional() }).optional(),
    granteeCapabilities: z.array(granteeCapabilitySchema).optional(),
  }),
});

export type GranteeCapability = z.infer<typeof granteeCapabilitySchema>;
export type WorkbookPermissions = z.infer<typeof workbookPermissionsSchema>;
