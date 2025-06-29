import { z } from 'zod';

export const flowParameterSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  description: z.string().optional(),
  value: z.string().optional(),
  isRequired: z.coerce.boolean(),
  domain: z.object({
    domainType: z.string(),
    values: z.object({
        value: z.array(z.string()),
    }).optional(),
  }).optional(),
});

export type FlowParameter = z.infer<typeof flowParameterSchema>;

export const flowParamsSchema = z.object({
  parameter: z.array(flowParameterSchema).optional(),
});

export type FlowParams = z.infer<typeof flowParamsSchema>;
