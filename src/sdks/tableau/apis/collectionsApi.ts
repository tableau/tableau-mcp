import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { pathParam } from '../../routeSafety/ids.js';
import {
  collectionItemsPageSchema,
  collectionMembershipRequestSchema,
  collectionMembershipResponseSchema,
  collectionSchema,
  collectionsPageSchema,
  createCollectionSchema,
  getCollectionResponseSchema,
} from '../types/collection.js';
import {
  collectionItemsFilterSchema,
  collectionItemsSortSchema,
  collectionsFilterSchema,
  collectionsSortSchema,
} from '../types/collectionsQuery.js';

// Cloud ignores the human-readable TAG query labels containing spaces. Use REST query keys;
// retain response metadata checks so ignored parameters cannot establish completeness.
const pagingParameters = [
  { name: 'pageNumber', type: 'Query', schema: z.number().int().optional() },
  { name: 'pageSize', type: 'Query', schema: z.number().int().optional() },
] as const;

const listCollectionsEndpoint = makeEndpoint({
  method: 'get',
  path: '/collections',
  alias: 'listCollections',
  parameters: [
    ...pagingParameters,
    { name: 'filter', type: 'Query', schema: collectionsFilterSchema.optional() },
    { name: 'sort', type: 'Query', schema: collectionsSortSchema.optional() },
  ] as const,
  response: collectionsPageSchema,
});

const createCollectionEndpoint = makeEndpoint({
  method: 'post',
  path: '/collections',
  alias: 'createCollection',
  parameters: [{ name: 'body', type: 'Body', schema: createCollectionSchema }],
  response: collectionSchema,
});

const getCollectionEndpoint = makeEndpoint({
  method: 'get',
  path: '/collections/:collectionId',
  alias: 'getCollection',
  parameters: [pathParam('collectionId')],
  response: getCollectionResponseSchema,
});

const listCollectionItemsEndpoint = makeEndpoint({
  method: 'get',
  path: '/collections/:collectionId/items',
  alias: 'listCollectionItems',
  parameters: [
    pathParam('collectionId'),
    ...pagingParameters,
    { name: 'filter', type: 'Query', schema: collectionItemsFilterSchema.optional() },
    { name: 'sort', type: 'Query', schema: collectionItemsSortSchema.optional() },
  ] as const,
  response: collectionItemsPageSchema,
});

const addCollectionItemsEndpoint = makeEndpoint({
  method: 'post',
  path: '/collections/:collectionId/items/batchCreate',
  alias: 'addCollectionItems',
  parameters: [
    pathParam('collectionId'),
    { name: 'body', type: 'Body', schema: collectionMembershipRequestSchema },
  ] as const,
  response: collectionMembershipResponseSchema,
});

const removeCollectionItemsEndpoint = makeEndpoint({
  method: 'post',
  path: '/collections/:collectionId/items/batchDelete',
  alias: 'removeCollectionItems',
  parameters: [
    pathParam('collectionId'),
    { name: 'body', type: 'Body', schema: collectionMembershipRequestSchema },
  ] as const,
  response: collectionMembershipResponseSchema,
});

const collectionsApi = makeApi([
  listCollectionsEndpoint,
  createCollectionEndpoint,
  getCollectionEndpoint,
  listCollectionItemsEndpoint,
  addCollectionItemsEndpoint,
  removeCollectionItemsEndpoint,
]);
export const collectionsApis = [...collectionsApi] as const satisfies ZodiosEndpointDefinitions;
