import { ZodiosError } from '@zodios/core';
import { isZodErrorLike } from 'zod-validation-error/v3';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { createGuardedZodios } from '../../routeSafety/zodios.js';
import {
  collectionOwnerPermissionsSchema,
  collectionPermissionsApis,
} from '../apis/collectionPermissionsApi.js';
import { RestApiCredentials } from '../restApi.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/** Site-scoped owner LUID proof; scope: tableau:permissions:read.
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_permissions.htm#query_collection_permissions
 */
export default class CollectionPermissionsMethods extends AuthenticatedMethods<
  typeof collectionPermissionsApis
> {
  constructor(baseUrl: string, creds: RestApiCredentials, axiosConfig: AxiosRequestConfig) {
    super(createGuardedZodios(baseUrl, collectionPermissionsApis, { axiosConfig }), creds);
  }

  queryCollectionOwner = async ({
    siteId,
    collectionId,
  }: {
    siteId: string;
    collectionId: string;
  }): Promise<{ collectionId: string; ownerId: string }> => {
    try {
      const response = await this._apiClient.queryCollectionOwner({
        params: { siteId, collectionId },
        headers: { ...this.authHeader.headers, Accept: 'application/json' },
      });
      // Also validate non-JSON responses; never retain a validation cause containing grants.
      const parsed = collectionOwnerPermissionsSchema.safeParse(response);
      if (!parsed.success) throw new Error('Collection owner permissions could not be verified.');
      return {
        collectionId: parsed.data.permissions.collection.id,
        ownerId: parsed.data.permissions.collection.owner.id,
      };
    } catch (error) {
      if (error instanceof ZodiosError && isZodErrorLike(error.cause))
        throw new Error('Collection owner permissions could not be verified.');
      throw error;
    }
  };
}
