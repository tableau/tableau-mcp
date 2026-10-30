import { z } from 'zod';

import { luidSchema } from '../../routeSafety/ids.js';
import { tagsSchema } from './tags.js';

// Recent-content references may contain only an ID. In particular, projectSchema requires a
// name that Get Recently Viewed for Site does not always return.
const recentReferenceSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
});

const recentMetadataSchema = z.object({
  // IDs originate in the API response, but cross into detail-request paths during access checks.
  // Validate them before that trust boundary, even if no bounded context would trigger a probe.
  id: luidSchema,
  name: z.string(),
  contentUrl: z.string(),
  // These are content creation/update times, not the time the user accessed the item.
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  project: recentReferenceSchema.optional(),
  owner: recentReferenceSchema.optional(),
  tags: tagsSchema.optional(),
});

const recentBooleanSchema = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true');

export const recentViewSchema = recentMetadataSchema.extend({
  viewUrlName: z.string().optional(),
  workbook: recentReferenceSchema.optional(),
});

export const recentWorkbookSchema = recentMetadataSchema.extend({
  description: z.string().optional(),
  webpageUrl: z.string().optional(),
  showTabs: recentBooleanSchema.optional(),
  size: z
    .union([z.number(), z.string().regex(/^\d+(\.\d+)?$/)])
    .pipe(z.coerce.number().finite().nonnegative())
    .optional(),
  encryptExtracts: recentBooleanSchema.optional(),
  defaultViewId: z.string().optional(),
});

// A row must identify exactly one supported resource. Reject ambiguous/unsupported rows instead
// of silently accepting one branch or treating them as an empty result.
export const recentContentSchema = z.union([
  z.object({ view: recentViewSchema }).strict(),
  z.object({ workbook: recentWorkbookSchema }).strict(),
]);

export type RecentContent = z.infer<typeof recentContentSchema>;

// JSON fixture contract derived from Tableau's documented XML recents/recent response and the
// SDK's JSON conventions. Keep this contract explicit until it is validated against a live site.
export const recentContentResponseSchema = z.object({
  recents: z.object({ recent: z.array(recentContentSchema).max(24).optional() }),
});
