import { z } from 'zod';

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
  topLevelProject: z.coerce.boolean().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  owner: z
    .object({
      id: z.string(),
    })
    .optional(),
});

export type Project = z.infer<typeof projectSchema>;
