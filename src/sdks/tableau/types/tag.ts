import { z } from 'zod';

export const tagSchema = z.object({
  label: z.string(),
});

export type Tag = z.infer<typeof tagSchema>;

export const tagsSchema = z.object({
  tag: z.array(tagSchema).optional(),
});

export type Tags = z.infer<typeof tagSchema>;
