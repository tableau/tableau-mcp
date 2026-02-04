import { z } from 'zod';

export const tagsSchema = z.object({ tag: z.array(z.object({ label: z.string() })).optional() });
