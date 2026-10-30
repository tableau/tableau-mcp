import { z } from 'zod';

import { luidSchema } from '../../routeSafety/ids.js';

// The TAG OpenAPI marks response-model properties optional. Keep documented fields optional, but
// strip unknown response properties so newly introduced server metadata is never exposed through
// the MCP boundary without an explicit review.
const optionalString = z.string().optional();
const optionalNullableString = z.string().nullable().optional();
const optionalInteger = z.number().int().optional();
export const collectionErrorSchema = z
  .object({
    errorCode: optionalInteger,
    errorMessage: optionalString,
    luid: optionalNullableString,
    erroredItem: z
      .object({
        contentLuid: optionalString,
        contentType: optionalString,
        contentName: optionalString,
      })
      .strip()
      .optional(),
  })
  .strip();

export const collectionSchema = z
  .object({
    createdTime: optionalString,
    description: optionalNullableString,
    luid: optionalString,
    name: optionalString,
    ownerAlias: optionalNullableString,
    ownerDomain: optionalNullableString,
    ownerName: optionalNullableString,
    siteId: optionalString,
    updatedTime: optionalString,
    userId: optionalString,
    visibility: optionalString,
    favorite: z.boolean().optional(),
    id: optionalInteger,
    permissionedItemCount: optionalInteger,
    totalItemCount: optionalInteger,
  })
  .strip();

export const collectionItemSchema = z
  .object({
    addedDate: optionalString,
    collectionLuid: optionalString,
    content: z
      .object({
        contentType: optionalString,
        syncToken: optionalString,
        title: optionalString,
        id: optionalInteger,
        siteId: optionalInteger,
      })
      .strip()
      .optional(),
    position: optionalInteger,
  })
  .strip();

const pageFields = {
  errors: z.array(collectionErrorSchema).optional(),
  moreItems: z.boolean().optional(),
  pagination: z
    .object({
      pageNumber: optionalInteger,
      pageSize: optionalInteger,
      totalAvailable: optionalInteger,
    })
    .strip()
    .optional(),
  totalCount: optionalInteger,
};

export const collectionsPageSchema = z
  .object({ ...pageFields, items: z.array(collectionSchema).optional() })
  .strip();
export const collectionItemsPageSchema = z
  .object({ ...pageFields, items: z.array(collectionItemSchema).optional() })
  .strip();
export const getCollectionResponseSchema = z
  .object({
    collection: collectionSchema.optional(),
    errors: z.array(collectionErrorSchema).optional(),
  })
  .strip();

export const collectionMembershipResponseSchema = z
  .object({
    errors: z.array(collectionErrorSchema).optional(),
    response: optionalInteger,
    typeToMatchJSON: optionalString,
  })
  .strip();

export const createCollectionSchema = z
  .object({
    name: z.string().trim().min(1),
    description: z.string().optional(),
  })
  .strict();

// OpenAPI has no contentType enum/casing guarantee. Requiring these fields is local validation,
// not a claim that any particular type spelling has been verified against a live deployment.
export const collectionMembershipItemSchema = z
  .object({
    contentLuid: luidSchema,
    contentType: z
      .string()
      .max(64, 'contentType cannot exceed 64 UTF-16 code units.')
      .refine(
        (value) =>
          value.trim().length > 0 &&
          [...value].every(
            (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
          ),
        'contentType must be nonblank and cannot contain control characters.',
      )
      .transform((value) => value.trim()),
    contentName: z.string().max(256, 'contentName cannot exceed 256 UTF-16 code units.').optional(),
  })
  .strict();
export const MAX_COLLECTION_MEMBERSHIP_ITEMS = 100;
export const collectionMembershipRequestSchema = z
  .object({
    items: z
      .array(collectionMembershipItemSchema)
      .min(1)
      .max(MAX_COLLECTION_MEMBERSHIP_ITEMS)
      .superRefine((items, context) => {
        const targets = new Set<string>();
        items.forEach((item, index) => {
          const target = `${item.contentType.toLowerCase()}\u0000${item.contentLuid.toLowerCase()}`;
          if (targets.has(target)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Duplicate collection membership targets are not allowed.',
              path: [index],
            });
          }
          targets.add(target);
        });
      }),
  })
  .strict();

export type Collection = z.infer<typeof collectionSchema>;
export type CollectionItem = z.infer<typeof collectionItemSchema>;
export type CollectionsPage = z.infer<typeof collectionsPageSchema>;
export type CollectionItemsPage = z.infer<typeof collectionItemsPageSchema>;
export type CollectionMembershipItem = z.infer<typeof collectionMembershipItemSchema>;
export type CollectionMembershipResponse = z.infer<typeof collectionMembershipResponseSchema>;

export type CollectionDetails = z.infer<typeof getCollectionResponseSchema>;
