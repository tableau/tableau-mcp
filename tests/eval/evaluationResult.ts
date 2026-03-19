import z from 'zod';

export const evaluationSchema = z.object({
  accuracy: z.number(),
  completeness: z.number(),
  relevance: z.number(),
  clarity: z.number(),
  reasoning: z.number(),
  comments: z.string(),
});
