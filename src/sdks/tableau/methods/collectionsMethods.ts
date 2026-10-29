import { ZodiosError } from '@zodios/core';
import { z } from 'zod';
import { isZodErrorLike } from 'zod-validation-error/v3';

import { ArgsValidationError, McpToolError } from '../../../errors/mcpToolError.js';
import { AxiosRequestConfig } from '../../../utils/axios.js';
import { createGuardedZodios } from '../../routeSafety/zodios.js';
import { collectionsApis } from '../apis/collectionsApi.js';
import { RestApiCredentials } from '../restApi.js';
import {
  Collection,
  CollectionDetails,
  CollectionItemsPage,
  collectionItemsPageSchema,
  CollectionMembershipItem,
  CollectionMembershipResponse,
  collectionMembershipResponseSchema,
  collectionSchema,
  CollectionsPage,
  collectionsPageSchema,
  getCollectionResponseSchema,
} from '../types/collection.js';
import AuthenticatedMethods from './authenticatedMethods.js';

export type CollectionsQuery = {
  pageNumber?: number;
  pageSize?: number;
  filter?: string;
  sort?: string;
};

/** Curated errors deliberately retain no raw response, cause, or validation message. */
function responseValidationError(operation: 'read' | 'create' | 'membership'): McpToolError {
  const mutationWarning =
    operation === 'create'
      ? 'Collection creation may have occurred. Inspect the site before retrying to avoid duplicate collections. No automatic retry was made.'
      : 'Collection membership changes may have occurred. Inspect the collection before retrying. No automatic retry was made.';
  return new McpToolError({
    type: 'collections-response-unverified',
    statusCode: 502,
    message:
      'The Collections response could not be validated safely; its raw contents were withheld. ' +
      (operation === 'read' ? 'No collection change was requested by this read.' : mutationWarning),
  });
}

/** Official Collections REST API under /api/-, using the authenticated session's site. */
export default class CollectionsMethods extends AuthenticatedMethods<typeof collectionsApis> {
  constructor(baseUrl: string, creds: RestApiCredentials, axiosConfig: AxiosRequestConfig) {
    super(createGuardedZodios(baseUrl, collectionsApis, { axiosConfig }), creds);
  }

  private get jsonAuthHeader(): { headers: Record<string, string> } {
    return {
      headers: {
        ...this.authHeader.headers,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    };
  }

  private queries({ pageNumber, pageSize, filter, sort }: CollectionsQuery): {
    'page number': number | undefined;
    'page size': number | undefined;
    filter: string | undefined;
    'sort order': string | undefined;
  } {
    return { 'page number': pageNumber, 'page size': pageSize, filter, 'sort order': sort };
  }

  private async execute<S extends z.ZodTypeAny>(
    schema: S,
    operation: 'read' | 'create' | 'membership',
    callback: () => Promise<unknown>,
  ): Promise<z.output<S>> {
    try {
      const response = await callback();
      // Zodios skips response validation for missing/non-JSON Content-Type. Always validate here.
      const parsed = schema.safeParse(response);
      if (!parsed.success) throw responseValidationError(operation);
      return parsed.data;
    } catch (error) {
      if (error instanceof ZodiosError && isZodErrorLike(error.cause)) {
        // A request-schema rejection is pre-dispatch; do not misreport it as a possible mutation.
        if (!error.message.startsWith('Zodios: Invalid response from endpoint')) {
          throw new ArgsValidationError('Collections request parameters did not pass validation.');
        }
        throw responseValidationError(operation);
      }
      // RouteSafetyError, authentication, permission, and other HTTP failures retain their classes.
      throw error;
    }
  }

  listCollections = async (query: CollectionsQuery = {}): Promise<CollectionsPage> =>
    await this.execute(
      collectionsPageSchema,
      'read',
      async () =>
        await this._apiClient.listCollections({
          queries: this.queries(query),
          ...this.jsonAuthHeader,
        }),
    );

  createCollection = async (body: { name: string; description?: string }): Promise<Collection> =>
    await this.execute(
      collectionSchema,
      'create',
      async () => await this._apiClient.createCollection(body, this.jsonAuthHeader),
    );

  getCollection = async (collectionId: string): Promise<CollectionDetails> =>
    await this.execute(
      getCollectionResponseSchema,
      'read',
      async () =>
        await this._apiClient.getCollection({ params: { collectionId }, ...this.jsonAuthHeader }),
    );

  listCollectionItems = async ({
    collectionId,
    ...query
  }: CollectionsQuery & { collectionId: string }): Promise<CollectionItemsPage> =>
    await this.execute(
      collectionItemsPageSchema,
      'read',
      async () =>
        await this._apiClient.listCollectionItems({
          params: { collectionId },
          queries: this.queries(query),
          ...this.jsonAuthHeader,
        }),
    );

  addCollectionItems = async ({
    collectionId,
    items,
  }: {
    collectionId: string;
    items: CollectionMembershipItem[];
  }): Promise<CollectionMembershipResponse> =>
    await this.execute(
      collectionMembershipResponseSchema,
      'membership',
      async () =>
        await this._apiClient.addCollectionItems(
          { items },
          { params: { collectionId }, ...this.jsonAuthHeader },
        ),
    );

  removeCollectionItems = async ({
    collectionId,
    items,
  }: {
    collectionId: string;
    items: CollectionMembershipItem[];
  }): Promise<CollectionMembershipResponse> =>
    await this.execute(
      collectionMembershipResponseSchema,
      'membership',
      async () =>
        await this._apiClient.removeCollectionItems(
          { items },
          { params: { collectionId }, ...this.jsonAuthHeader },
        ),
    );
}
