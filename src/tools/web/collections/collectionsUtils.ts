import { McpToolError } from '../../../errors/mcpToolError.js';
import { BoundedContext } from '../../../overridableConfig.js';
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
  'Candidate uses literal TAG query names "page number", "page size", "sort order". ' +
  'The official overview differs; target-deployment query spelling and contentType casing need live verification. ' +
  'Only one page is fetched; this result is not a complete inventory.';

export function hasCollectionsBounds(context: BoundedContext): boolean {
  return Object.values(context).some((value) => value !== null);
}

export function assertCollectionListingAllowed(context: BoundedContext): void {
  if (hasCollectionsBounds(context)) {
    throw new McpToolError({
      type: 'collections-bounded-context-unsupported',
      statusCode: 403,
      message:
        'Collections listing is unavailable with configured content restrictions. The documented item ' +
        'schema exposes numeric internal IDs without content LUIDs, so this candidate cannot safely ' +
        'resolve collection members against bounded-context controls.',
    });
  }
}

/** All members pass before any batch mutation; unknown types fail closed under constraints. */
export async function assertCollectionMembersAllowed(
  items: CollectionMembershipItem[],
  extra: TableauWebRequestHandlerExtra,
): Promise<void> {
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
      throw new McpToolError({
        type: 'collection-member-not-allowed',
        statusCode: 403,
        message:
          'A collection member could not be verified against the configured content restrictions. No collection membership was changed.',
      });
    }
  }
}

/** Owner-only candidate policy, stricter than Tableau's administrator exception. */
export async function assertCollectionOwner(restApi: RestApi, collectionId: string): Promise<void> {
  let userId = restApi.userId;
  if (!luidSchema.safeParse(userId).success) {
    const session = await restApi.authenticatedServerMethods.getCurrentServerSession();
    if (
      session.isErr() ||
      session.value.site.id !== restApi.siteId ||
      !luidSchema.safeParse(session.value.user.id).success
    ) {
      throw new McpToolError({
        type: 'collection-owner-unverified',
        statusCode: 403,
        message:
          'The signed-in user could not be verified for this authenticated site. No collection membership was changed.',
      });
    }
    userId = session.value.user.id;
  }
  const details = await restApi.collectionsMethods.getCollection(collectionId);
  if (
    details.errors?.length ||
    details.collection?.luid !== collectionId ||
    details.collection.userId !== userId ||
    details.collection.siteId !== restApi.siteId
  ) {
    throw new McpToolError({
      type: 'collection-owner-unverified',
      statusCode: 403,
      message:
        'This candidate changes membership only in collections verified as owned by the signed-in user on this site. Ownership could not be established. No collection membership was changed.',
    });
  }
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
