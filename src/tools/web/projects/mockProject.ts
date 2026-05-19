import { Project } from '../../../sdks/tableau/types/project.js';

export const mockProject = {
  id: 'ae5e9374-2a58-40ab-93e4-a2fd1b07cf7d',
  name: 'Samples',
  description: 'Sample content shipped with Tableau.',
  contentPermissions: 'ManagedByOwner',
  topLevelProject: true,
  createdAt: '2023-01-01T00:00:00Z',
  updatedAt: '2023-06-01T00:00:00Z',
  owner: { id: 'fe1c0c8d-1d95-4d4d-9a1e-3a3f0a8e4b1a' },
} satisfies Project;

export const mockProject2 = {
  id: '4862efd9-3c24-4053-ae1f-18caf18b6ffe',
  name: 'Finance',
  parentProjectId: mockProject.id,
  contentPermissions: 'LockedToProject',
  topLevelProject: false,
  createdAt: '2023-02-15T00:00:00Z',
  updatedAt: '2023-07-10T00:00:00Z',
  owner: { id: '7b1f1f5d-2c33-4d4e-bc8f-9e1a2c8d4f1e' },
} satisfies Project;
