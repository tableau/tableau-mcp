import { ZodiosError } from '@zodios/core';
import { isZodErrorLike } from 'zod-validation-error/v3';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { createGuardedZodios } from '../../routeSafety/zodios.js';
import {
  favoritesApis,
  favoritesPageResponseSchema,
  favoritesResponseSchema,
} from '../apis/favoritesApi.js';
import { RestApiCredentials } from '../restApi.js';
import { Favorite, FavoriteResourceType, normalizeFavorite } from '../types/favorite.js';
import { Pagination } from '../types/pagination.js';
import AuthenticatedMethods from './authenticatedMethods.js';

const favoriteRoutes = {
  workbook: 'workbooks',
  view: 'views',
  datasource: 'datasources',
  project: 'projects',
  flow: 'flows',
} as const satisfies Record<FavoriteResourceType, string>;

type FavoriteTarget = {
  siteId: string;
  userId: string;
  resourceType: FavoriteResourceType;
  resourceId: string;
};

/**
 * Tableau favorites membership APIs. Callers must derive userId from the authenticated session.
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_favorites.htm
 */
export default class FavoritesMethods extends AuthenticatedMethods<typeof favoritesApis> {
  constructor(baseUrl: string, creds: RestApiCredentials, axiosConfig: AxiosRequestConfig) {
    super(createGuardedZodios(baseUrl, favoritesApis, { axiosConfig }), creds);
  }

  /** Get one favorites page. Required scope: tableau:content:read. */
  queryFavorites = async ({
    siteId,
    userId,
    pageSize,
    pageNumber,
  }: {
    siteId: string;
    userId: string;
    pageSize?: number;
    pageNumber?: number;
  }): Promise<{ favorites: Favorite[]; rawCount: number; pagination?: Pagination }> => {
    try {
      const response = await this._apiClient.queryFavorites({
        params: { siteId, userId },
        queries: { pageSize, pageNumber },
        ...this.authHeader,
      });
      // Zodios only validates JSON media types. Revalidate before using any response fields,
      // and never expose its schema error message, which can contain the full raw shortlist.
      const parsed = favoritesPageResponseSchema.safeParse(response);
      if (!parsed.success) throw new Error('Tableau returned an invalid favorites response.');
      const raw = parsed.data.favorites.favorite ?? [];
      if (pageSize !== undefined && raw.length > pageSize) {
        throw new Error('Tableau returned an invalid favorites response.');
      }
      return {
        favorites: raw.flatMap((favorite) => {
          const normalized = normalizeFavorite(favorite);
          return normalized ? [normalized] : [];
        }),
        rawCount: raw.length,
        pagination: parsed.data.pagination,
      };
    } catch (error) {
      if (error instanceof ZodiosError && isZodErrorLike(error.cause)) {
        throw new Error('Tableau returned an invalid favorites response.');
      }
      throw error;
    }
  };

  /** PUT { favorite: { label, [resourceType]: { id } } }. Scope: tableau:favorites:update. */
  addFavorite = async ({
    siteId,
    userId,
    resourceType,
    resourceId,
    label,
  }: FavoriteTarget & { label: string }): Promise<void> => {
    // Zodios validates the exclusive body union. Do not return the full favorites list from PUT,
    // which can contain unrelated entries outside the caller's bounded context.
    const favorite = { label, [resourceType]: { id: resourceId } } as
      | { label: string; workbook: { id: string } }
      | { label: string; view: { id: string } }
      | { label: string; datasource: { id: string } }
      | { label: string; project: { id: string } }
      | { label: string; flow: { id: string } };
    try {
      const response = await this._apiClient.addFavorite(
        { favorite },
        {
          params: { siteId, userId },
          ...this.authHeader,
        },
      );
      if (!favoritesResponseSchema.safeParse(response).success) {
        throw new Error(
          'The favorites response could not be validated. The favorite may have changed; check your shortlist before retrying.',
        );
      }
    } catch (error) {
      if (error instanceof ZodiosError && isZodErrorLike(error.cause)) {
        // A PUT can succeed before response validation fails. Do not report clean failure or
        // retain a cause containing raw favorites; callers must verify state before retrying.
        throw new Error(
          'The favorites response could not be validated. The favorite may have changed; check your shortlist before retrying.',
        );
      }
      throw error;
    }
  };

  /** DELETE favorites membership (204/empty body). Scope: tableau:favorites:delete. */
  removeFavorite = async ({
    siteId,
    userId,
    resourceType,
    resourceId,
  }: FavoriteTarget): Promise<void> => {
    await this._apiClient.removeFavorite(undefined, {
      params: { siteId, userId, resourceType: favoriteRoutes[resourceType], resourceId },
      ...this.authHeader,
    });
  };
}
