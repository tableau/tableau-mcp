import z from 'zod';

export const popcBanInsightGroupSchema = z.object({
  type: z.string(),
  insights: z.array(
    z.object({
      result: z.object({
        type: z.string(),
        version: z.number(),
        content: z.string().optional(),
        markup: z.string().optional(),
        viz: z.any().optional(),
        facts: z.any().optional(),
        characterization: z.string().optional(),
        question: z.string(),
        score: z.number(),
      }),
      insight_type: z.string(),
    }),
  ),
  summaries: z.array(
    z.object({
      result: z.object({
        id: z.string(),
        markup: z.string().optional(),
        viz: z.any().optional(),
        generation_id: z.string(),
        timestamp: z.string().optional(),
        last_attempted_timestamp: z.string().optional(),
      }),
    }),
  ),
});

export const pulseInsightBundleSchema = z.object({
  insight_groups: z.array(popcBanInsightGroupSchema),
  has_errors: z.boolean(),
  characterization: z.string(),
});

export type PulseInsightBundle = z.infer<typeof pulseInsightBundleSchema>;
