import { z } from 'zod';

// Tableau REST can deliver booleans as the strings "true"/"false"; `z.coerce.boolean()` would map
// "false" -> true (the `Boolean("false") === true` footgun) and mis-classify a nested project as
// top-level. Parse explicitly instead.
const tableauBoolean = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toLowerCase() === 'true' : value === true),
  z.boolean(),
);

export const contentPermissionsSchema = z.enum([
  'LockedToProject',
  'ManagedByOwner',
  'LockedToProjectWithoutNested',
]);

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  // `description` is not in the formal `<project>` XML schema for most endpoints,
  // but Tableau Server / Cloud does return it on responses where `<project>` is
  // embedded in another resource (e.g. `<flow>`, `<workbook>`). Capturing it as
  // optional is forward-compatible: endpoints that omit it just leave it undefined.
  description: z.string().optional(),
  parentProjectId: z.string().optional(),
  contentPermissions: contentPermissionsSchema.optional(),
  controllingPermissionsProjectId: z.string().optional(),
  // The Admin Insights resolver keys on `topLevelProject === true` when disambiguating duplicate
  // datasources (W-24106279).
  topLevelProject: tableauBoolean.optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  owner: z
    .object({
      id: z.string(),
    })
    .optional(),
});

export type Project = z.infer<typeof projectSchema>;
