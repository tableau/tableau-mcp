import { z } from 'zod';

import { luidSchema } from '../../routeSafety/ids.js';

// The TAG OpenAPI marks response-model properties optional. Keep unknown fields for forward
// compatibility; operations that need an identity or a page perform their own checks.
const optionalString = z.string().optional();
const optionalNullableString = z.string().nullable().optional();
const optionalInteger = z.number().int().optional();
export const collectionErrorSchema = z
  .object({
    errorCode: optionalInteger,
    errorMessage: optionalString,
    luid: optionalNullableString,
    erroredItem: z
      .object({ contentLuid: optionalString, contentType: optionalString })
      .passthrough()
      .optional(),
  })
  .passthrough();

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
  .passthrough();

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
      .passthrough()
      .optional(),
    extraData: z.record(z.number().int()).nullable().optional(),
    position: optionalInteger,
  })
  .passthrough();

const pageFields = {
  errors: z.array(collectionErrorSchema).optional(),
  moreItems: z.boolean().optional(),
  pagination: z
    .object({
      pageNumber: optionalInteger,
      pageSize: optionalInteger,
      totalAvailable: optionalInteger,
    })
    .passthrough()
    .optional(),
  totalCount: optionalInteger,
};

export const collectionsPageSchema = z
  .object({ ...pageFields, items: z.array(collectionSchema).optional() })
  .passthrough();
export const collectionItemsPageSchema = z
  .object({ ...pageFields, items: z.array(collectionItemSchema).optional() })
  .passthrough();
export const getCollectionResponseSchema = z
  .object({
    collection: collectionSchema.optional(),
    errors: z.array(collectionErrorSchema).optional(),
  })
  .passthrough();

export const collectionMembershipResponseSchema = z
  .object({
    errors: z.array(collectionErrorSchema).optional(),
    response: optionalInteger,
    typeToMatchJSON: optionalString,
  })
  .passthrough();

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
      .refine(
        (value) =>
          value.trim().length > 0 &&
          [...value].every(
            (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
          ),
        'contentType must be nonblank and cannot contain control characters.',
      )
      .transform((value) => value.trim()),
    contentName: z.string().optional(),
  })
  .strict();
export const collectionMembershipRequestSchema = z
  .object({ items: z.array(collectionMembershipItemSchema).min(1).max(1000) })
  .strict();

export type Collection = z.infer<typeof collectionSchema>;
export type CollectionItem = z.infer<typeof collectionItemSchema>;
export type CollectionsPage = z.infer<typeof collectionsPageSchema>;
export type CollectionItemsPage = z.infer<typeof collectionItemsPageSchema>;
export type CollectionMembershipItem = z.infer<typeof collectionMembershipItemSchema>;
export type CollectionMembershipResponse = z.infer<typeof collectionMembershipResponseSchema>;

export type CollectionDetails = z.infer<typeof getCollectionResponseSchema>;
