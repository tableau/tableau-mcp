import { z } from 'zod';

import { tagsSchema } from './tags.js';

const contentId = z.object({ id: z.string().min(1) });
const favoriteContent = contentId.extend({
  project: contentId.optional(),
  workbook: contentId.optional(),
  tags: tagsSchema.optional(),
});

export const favoriteTypes = ['workbook', 'view', 'datasource', 'flow', 'project'] as const;

export const favoriteSchema = z.object({
  workbook: favoriteContent.optional(),
  view: favoriteContent.optional(),
  datasource: favoriteContent.optional(),
  flow: favoriteContent.optional(),
  project: favoriteContent.optional(),
});

export type Favorite = z.infer<typeof favoriteSchema>;
export type FavoriteReference = { type: (typeof favoriteTypes)[number]; luid: string };
