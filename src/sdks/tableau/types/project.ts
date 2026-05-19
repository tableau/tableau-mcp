import { z } from 'zod';

export const contentPermissionsSchema = z.enum([
  'LockedToProject',
  'ManagedByOwner',
  'LockedToProjectWithoutNested',
]);

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
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
