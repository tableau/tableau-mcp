import { Ok, Result } from 'ts-results-es';

import { McpToolError } from '../../../errors/mcpToolError.js';
import { BoundedContext } from '../../../overridableConfig.js';
import { useRestApi } from '../../../restApiInstance.js';
import { RouteSafetyError } from '../../../sdks/routeSafety/core.js';
import { luidSchema } from '../../../sdks/routeSafety/ids.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import {
  Collection,
  CollectionItem,
  CollectionItemsPage,
  CollectionMembershipItem,
  CollectionsPage,
} from '../../../sdks/tableau/types/collection.js';
import {
  getRequestOverridesFromHeader,
  X_TABLEAU_MCP_CONFIG_HEADER,
} from '../../../server/requestUtils.js';
import { getConfigWithOverrides } from '../../../utils/mcpSiteSettings.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { TableauWebRequestHandlerExtra } from '../toolContext.js';

/** Quiet only this request's raw REST probes; keep global tool logging and masking unchanged. */
export function getQuietCollectionsExtra(
  extra: TableauWebRequestHandlerExtra,
): TableauWebRequestHandlerExtra & { disableLogging: true } {
  const quietExtra = { ...extra, disableLogging: true as const };
  // The server's original method closes over its normal extra. Rebuild with the same parser and
  // request/config/auth/site/user context so nested site-settings calls inherit disableLogging.
  quietExtra.getConfigWithOverrides = async () =>
    await getConfigWithOverrides({
      restApiArgs: quietExtra,
      requestOverrides: getRequestOverridesFromHeader(
        extra.requestInfo?.headers[X_TABLEAU_MCP_CONFIG_HEADER]?.toString() ?? '',
      ),
    });
  return quietExtra;
}

export const COLLECTIONS_WIRE_LIMITATION =
  'Uses REST query keys pageNumber, pageSize and sort; target-deployment paging and sorting need live verification. ' +
  'Collection membership contentType casing also needs live verification. ' +
  'Only one page is fetched; this result is not a complete inventory.';

export function hasCollectionsBounds(context: BoundedContext): boolean {
  return Object.values(context).some((value) => value !== null);
}

export function checkCollectionListingAllowed(context: BoundedContext): Result<void, McpToolError> {
  if (hasCollectionsBounds(context)) {
    return new McpToolError({
      type: 'collections-bounded-context-unsupported',
      statusCode: 403,
      message:
        'Collections listing is unavailable with configured content restrictions. The documented item ' +
        'schema exposes numeric internal IDs without content LUIDs, so this candidate cannot safely ' +
        'resolve collection members against bounded-context controls.',
    }).toErr();
  }
  return new Ok(undefined);
}

/** All members pass before any batch mutation; unknown types fail closed under constraints. */
export async function checkCollectionMembersAllowed(
  items: CollectionMembershipItem[],
  extra: TableauWebRequestHandlerExtra,
): Promise<Result<void, McpToolError>> {
  const quietExtra = getQuietCollectionsExtra(extra);
  const context = (await quietExtra.getConfigWithOverrides()).boundedContext;
  for (const item of items) {
    let result: { allowed: boolean; message?: string };
    switch (item.contentType) {
      case 'workbook':
        result = await resourceAccessChecker.isWorkbookAllowed({
          workbookId: item.contentLuid,
          extra: quietExtra,
        });
        break;
      case 'view':
        result = await resourceAccessChecker.isViewAllowed({
          viewId: item.contentLuid,
          extra: quietExtra,
        });
        break;
      case 'datasource':
        result = await resourceAccessChecker.isDatasourceAllowed({
          datasourceLuid: item.contentLuid,
          extra: quietExtra,
        });
        break;
      default:
        result = {
          allowed: !hasCollectionsBounds(context),
          message:
            'This contentType cannot be resolved by the existing resource access checker under configured content restrictions.',
        };
    }
    if (!result.allowed) {
      return new McpToolError({
        type: 'collection-member-not-allowed',
        statusCode: 403,
        message:
          'A collection member could not be verified against the configured content restrictions. No collection membership was changed.',
      }).toErr();
    }
  }
  return new Ok(undefined);
}

function ownerUnverified(): McpToolError {
  return new McpToolError({
    type: 'collection-owner-unverified',
    statusCode: 403,
    message:
      'This candidate changes membership only in collections verified as owned by the signed-in user on this site. Ownership could not be established. No collection membership was changed.',
  });
}

async function authenticatedCollectionUserId(
  restApi: RestApi,
): Promise<Result<string, McpToolError>> {
  let userId = restApi.userId;
  if (!luidSchema.safeParse(userId).success) {
    const session = await restApi.authenticatedServerMethods.getCurrentServerSession();
    if (
      session.isErr() ||
      session.value.site.id !== restApi.siteId ||
      !luidSchema.safeParse(session.value.user.id).success
    ) {
      return ownerUnverified().toErr();
    }
    userId = session.value.user.id;
  }
  return new Ok(userId);
}

export type VerifiedCollectionOwner = Readonly<{
  serverOrigin: string;
  siteId: string;
  userId: string;
  collectionId: string;
  collectionSiteId: string;
  collectionUserId: string;
}>;

async function checkOwnerActor(
  restApi: RestApi,
  proof: VerifiedCollectionOwner,
): Promise<Result<void, McpToolError>> {
  if (restApi.serverOrigin !== proof.serverOrigin || restApi.siteId !== proof.siteId)
    return ownerUnverified().toErr();
  const userId = await authenticatedCollectionUserId(restApi);
  if (userId.isErr() || userId.value !== proof.userId) return ownerUnverified().toErr();
  return new Ok(undefined);
}

/** Complete each read before opening the next session: PAT sign-in invalidates older sessions. */
export async function verifyCollectionOwner(
  collectionId: string,
  extra: TableauWebRequestHandlerExtra,
): Promise<Result<VerifiedCollectionOwner, McpToolError>> {
  const quietExtra = getQuietCollectionsExtra(extra);
  const inspected = await useRestApi({
    ...quietExtra,
    jwtScopes: ['tableau:collections:read'],
    callback: async (restApi) => {
      const serverOrigin = restApi.serverOrigin;
      const siteId = restApi.siteId;
      const userId = await authenticatedCollectionUserId(restApi);
      if (userId.isErr()) return userId;
      const details = await restApi.collectionsMethods.getCollection(collectionId);
      const collection = details.collection;
      if (
        details.errors?.length ||
        collection?.luid !== collectionId ||
        !collection.siteId ||
        !collection.userId ||
        !serverOrigin ||
        !luidSchema.safeParse(siteId).success
      )
        return ownerUnverified().toErr();
      const proof: VerifiedCollectionOwner = {
        serverOrigin,
        siteId,
        userId: userId.value,
        collectionId,
        collectionSiteId: collection.siteId,
        collectionUserId: collection.userId,
      };
      const actor = await checkOwnerActor(restApi, proof);
      if (actor.isErr()) return actor;
      if (collection.siteId === proof.siteId && collection.userId === proof.userId)
        return new Ok({ proof, numeric: false });
      // No fallback for a UUID mismatch, a missing identity, or mixed representations.
      if (!/^[0-9]+$/.test(collection.siteId) || !/^[0-9]+$/.test(collection.userId))
        return ownerUnverified().toErr();
      return new Ok({ proof, numeric: true });
    },
  });
  if (inspected.isErr()) return inspected;
  const { proof, numeric } = inspected.value;
  if (numeric) {
    try {
      const verified = await useRestApi({
        ...quietExtra,
        jwtScopes: ['tableau:permissions:read'],
        callback: async (restApi) => {
          const actor = await checkOwnerActor(restApi, proof);
          if (actor.isErr()) return actor;
          const owner = await restApi.collectionPermissionsMethods.queryCollectionOwner({
            siteId: proof.siteId,
            collectionId,
          });
          if (owner.collectionId !== collectionId || owner.ownerId !== proof.userId)
            return ownerUnverified().toErr();
          return await checkOwnerActor(restApi, proof);
        },
      });
      if (verified.isErr()) return verified;
    } catch (error) {
      if (error instanceof RouteSafetyError) throw error;
      // Permission failures can contain unrelated grants or private labels. Retain no cause.
      return ownerUnverified().toErr();
    }
  }
  return new Ok(Object.freeze(proof));
}

/** Check the mutation actor and unchanged raw identity without opening another REST session. */
export async function checkCollectionOwnerSession(
  restApi: RestApi,
  proof: VerifiedCollectionOwner,
): Promise<Result<void, McpToolError>> {
  const actor = await checkOwnerActor(restApi, proof);
  if (actor.isErr()) return actor;
  const details = await restApi.collectionsMethods.getCollection(proof.collectionId);
  const currentActor = await checkOwnerActor(restApi, proof);
  if (currentActor.isErr()) return currentActor;
  if (
    details.errors?.length ||
    details.collection?.luid !== proof.collectionId ||
    details.collection.siteId !== proof.collectionSiteId ||
    details.collection.userId !== proof.collectionUserId
  )
    return ownerUnverified().toErr();
  return new Ok(undefined);
}

export type CollectionPageResultInfo = {
  requestedPageNumber: number;
  requestedPageSize: number;
  returnedItemCount: number;
  configuredResultLimit: number | null;
  pageMetadataMatchesRequest: boolean;
  completeness: 'unverified';
  warnings: string[];
};

/** Preserve metadata; never claim full or advancing pagination from an unverified wire spelling. */
export function describeCollectionPage(
  response: CollectionsPage | CollectionItemsPage,
  pageNumber: number,
  pageSize: number,
  maxResultLimit: number | null,
): {
  [key: string]: unknown;
  items: Array<Collection | CollectionItem>;
  errors?: CollectionsPage['errors'];
  moreItems?: boolean;
  pagination?: CollectionsPage['pagination'];
  totalCount?: number;
  resultInfo: CollectionPageResultInfo;
} {
  const warnings = [COLLECTIONS_WIRE_LIMITATION];
  const pagination = response.pagination;
  const metadataMatches = pagination?.pageNumber === pageNumber && pagination.pageSize === pageSize;
  if (!metadataMatches)
    warnings.push(
      'Pagination metadata is missing or differs from the requested page. The server may have ignored the paging parameters; do not treat this as an advancing page.',
    );
  if (response.items === undefined)
    warnings.push('Response omitted items; an empty collection inventory cannot be established.');
  if (response.errors?.length)
    warnings.push('Tableau returned item-level errors. Results may be partial.');
  if (
    response.totalCount !== undefined &&
    pagination?.totalAvailable !== undefined &&
    response.totalCount !== pagination.totalAvailable
  )
    warnings.push(
      'totalCount and pagination.totalAvailable disagree; completeness cannot be established.',
    );
  const offset = (pageNumber - 1) * pageSize;
  const allowed =
    maxResultLimit === null ? pageSize : Math.max(0, Math.min(pageSize, maxResultLimit - offset));
  const items = (response.items ?? []).slice(0, allowed);
  if ((response.items?.length ?? 0) > items.length)
    warnings.push(
      'Returned items were trimmed by the requested page size or configured result limit.',
    );
  const resultInfo: CollectionPageResultInfo = {
    requestedPageNumber: pageNumber,
    requestedPageSize: pageSize,
    returnedItemCount: items.length,
    configuredResultLimit: maxResultLimit,
    pageMetadataMatchesRequest: metadataMatches,
    completeness: 'unverified',
    warnings,
  };
  return { ...response, items, resultInfo };
}
