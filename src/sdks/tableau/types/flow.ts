import { z } from 'zod';

import { projectSchema } from './project.js';
import { tagsSchema } from './tags.js';

export const flowParameterDomainSchema = z
  .object({
    domainType: z.string().optional(),
  })
  .passthrough();

export const flowParameterSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  description: z.string().optional(),
  value: z.string().optional(),
  isRequired: z.coerce.boolean().optional(),
  domain: flowParameterDomainSchema.optional(),
});

export type FlowParameter = z.infer<typeof flowParameterSchema>;

export const flowOutputStepSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type FlowOutputStep = z.infer<typeof flowOutputStepSchema>;

// `<connection>` fields per the official Query Flow Connections response schema
// (https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#query_flow_connections).
// Tableau also emits `useOAuthManagedKeychain` and `queryTaggingEnabled` in
// some responses; those are intentionally not surfaced because they are
// undocumented and primarily of interest to admins, not LLM consumers.
export const flowConnectionSchema = z.object({
  id: z.string(),
  type: z.string().optional(),
  serverAddress: z.string().optional(),
  userName: z.string().optional(),
  embedPassword: z.coerce.boolean().optional(),
});

export type FlowConnection = z.infer<typeof flowConnectionSchema>;

// `<owner>` per the formal spec only carries `id`, but Tableau Server / Cloud
// is observed to return additional identity fields (`name`, `fullName`, `email`,
// `siteRole`, `lastLogin`) when the owner is visible to the caller. They are
// extremely useful signal for an LLM (e.g. "who owns this flow?") so we capture
// them opportunistically as optionals — endpoints/versions that omit them just
// leave the fields undefined.
export const flowOwnerSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  fullName: z.string().optional(),
  email: z.string().optional(),
  siteRole: z.string().optional(),
  lastLogin: z.string().optional(),
});

export type FlowOwner = z.infer<typeof flowOwnerSchema>;

export const flowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  webpageUrl: z.string().optional(),
  fileType: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  project: projectSchema.optional(),
  owner: flowOwnerSchema.optional(),
  tags: tagsSchema.optional(),
  parameters: z
    .object({
      parameter: z.array(flowParameterSchema).optional(),
    })
    .optional(),
});

export type Flow = z.infer<typeof flowSchema>;

export const flowRunStatusSchema = z.enum([
  'Pending',
  'InProgress',
  'Success',
  'Failed',
  'Cancelled',
]);

export type FlowRunStatus = z.infer<typeof flowRunStatusSchema>;

export const flowParameterRunSchema = z.object({
  parameterId: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  overrideValue: z.string().optional(),
});

export type FlowParameterRun = z.infer<typeof flowParameterRunSchema>;

export const flowRunSchema = z.object({
  id: z.string(),
  flowId: z.string().optional(),
  status: flowRunStatusSchema.optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  progress: z.coerce.number().optional(),
  backgroundJobId: z.string().optional(),
  flowParameterRuns: z
    .object({
      parameterRuns: z.array(flowParameterRunSchema).optional(),
    })
    .optional(),
});

export type FlowRun = z.infer<typeof flowRunSchema>;
