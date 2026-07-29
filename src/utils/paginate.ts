import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { PulseResult } from '../sdks/tableau/methods/pulseMethods.js';
import { Pagination, PulsePagination } from '../sdks/tableau/types/pagination.js';

const pageConfigSchema = z
  .object({
    pageSize: z.coerce.number().gt(0),
    pageNumber: z.coerce.number().gt(0),
    limit: z.coerce.number().gt(0),
  })
  .partial();

type PageConfig = z.infer<typeof pageConfigSchema>;

type PaginateArgs<T> = {
  pageConfig: PageConfig;
  getDataFn: (pagination: PageConfig) => Promise<{ pagination: Pagination; data: Array<T> }>;
  /**
   * OPT-IN client-side predicate. When provided, {@link paginateWithMetadata}
   * fetches pages by `pageSize` (the raw `limit` is deliberately NOT threaded
   * into the fetch), applies this predicate to every fetched row, and counts
   * ONLY passing rows toward `limit`. `limit` therefore bounds POST-filter
   * matches, and `truncatedByLimit` reflects POST-filter truncation.
   *
   * When omitted, the pagination behavior is byte-for-byte identical to the
   * original implementation (raw `limit` bounds the fetch and the returned
   * slice). This invariant is load-bearing: existing callers (`list-flows`,
   * `list-flow-runs`, `list-projects`, …) rely on the no-filter path and must
   * not change. See the explicit no-filter branch in {@link paginateWithMetadata}.
   */
  filterFn?: (item: T) => boolean;
};

export const MAX_PAGE_SIZE = 1000;

/**
 * Result of {@link paginateWithMetadata}: the items plus enough server-side
 * metadata for the caller to detect whether a configured `limit` truncated the
 * result.
 *
 * - `items` — the (possibly limit-truncated) items returned to the caller.
 * - `totalAvailable` — the total count Tableau reported for the underlying
 *   query (across all pages, ignoring `limit`). For multi-page paginations
 *   this is the value Tableau returned on the last page actually fetched;
 *   Tableau returns the same value on every page response, so for the loops
 *   we run it's stable. NOTE: when a `filterFn` is supplied this is the
 *   server's RAW, PRE-filter count — it is NOT a count of matching rows and
 *   cannot be (the server does no filtering). With a filter, callers should
 *   rely on `truncatedByLimit` (not `totalAvailable`) as the "more matches
 *   exist server-side" signal.
 * - `truncatedByLimit` — `true` iff more rows exist server-side beyond the
 *   returned (limited) set. Without a filter this is `items.length <
 *   totalAvailable`. With a filter it means more MATCHING rows exist beyond the
 *   `limit` returned. When `true`, the caller can confidently surface a "more
 *   results available, but a limit cut you off" signal (e.g. an MCP warning).
 */
export type PaginateResult<T> = {
  items: Array<T>;
  totalAvailable: number;
  truncatedByLimit: boolean;
};

/**
 * Like {@link paginate}, but also surfaces enough metadata for the caller to
 * detect when the configured `limit` truncated the result. Existing callers
 * that only need the items array should keep using {@link paginate}; this
 * function exists so individual list-* tools can opt into a "results were
 * limited; more exist server-side" signal without forcing every other
 * caller to migrate.
 *
 * The two functions share a single implementation — {@link paginate} simply
 * returns the `items` field of this function's result.
 */
export async function paginateWithMetadata<T>({
  pageConfig,
  getDataFn,
  filterFn,
}: PaginateArgs<T>): Promise<PaginateResult<T>> {
  const { pageSize, limit } = pageConfigSchema.parse(pageConfig);
  const effectivePageSize = pageSize ? Math.min(pageSize, MAX_PAGE_SIZE) : pageSize;

  // --- Filtered path (opt-in) ---------------------------------------------
  // When a predicate is supplied, `limit` must bound POST-filter matches, not
  // the fetch. So we page by `pageSize` (deliberately NOT threading raw `limit`
  // into getDataFn) and count only rows that PASS toward `limit`. To set
  // `truncatedByLimit` HONESTLY we collect until we have `limit + 1` matches —
  // one past the limit proves more matches exist server-side — or the server's
  // pages are exhausted. `totalAvailable` here is the server's RAW pre-filter
  // count (the server does no filtering); with a filter the truncation SIGNAL,
  // not `totalAvailable`, is what tells the model "more matches exist".
  if (filterFn) {
    const first = await getDataFn({
      pageSize: effectivePageSize,
      pageNumber: pageConfig.pageNumber,
    });
    let { totalAvailable, pageNumber } = first.pagination;
    let rawFetched = first.data.length;
    const matches = first.data.filter(filterFn);

    while (totalAvailable > rawFetched && (!limit || matches.length <= limit)) {
      const { pagination: nextPagination, data: nextData } = await getDataFn({
        pageSize: effectivePageSize,
        pageNumber: pageNumber + 1,
      });

      if (nextData.length === 0) {
        throw new Error(
          `No more data available. Last fetched page number: ${pageNumber}, Total available: ${totalAvailable}, Total fetched: ${rawFetched}`,
        );
      }

      ({ totalAvailable, pageNumber } = nextPagination);
      rawFetched += nextData.length;
      for (const item of nextData) {
        if (filterFn(item)) {
          matches.push(item);
        }
      }
    }

    const truncatedByLimit = limit !== undefined && matches.length > limit;
    if (truncatedByLimit) {
      matches.length = limit;
    }

    return { items: matches, totalAvailable, truncatedByLimit };
  }

  // --- No-filter path -------------------------------------------------------
  // INVARIANT: behavior below MUST stay byte-for-byte identical to the original
  // implementation. Other callers (list-flows, list-flow-runs, list-projects,
  // …) depend on it; do NOT alter this branch when touching the filtered path.
  const { pagination, data } = await getDataFn({ ...pageConfig, pageSize: effectivePageSize });
  const items = [...data];

  let { totalAvailable, pageNumber } = pagination;
  while (totalAvailable > items.length && (!limit || limit > items.length)) {
    const { pagination: nextPagination, data: nextData } = await getDataFn({
      pageSize: effectivePageSize,
      pageNumber: pageNumber + 1,
      limit,
    });

    if (nextData.length === 0) {
      throw new Error(
        `No more data available. Last fetched page number: ${pageNumber}, Total available: ${totalAvailable}, Total fetched: ${items.length}`,
      );
    }

    ({ totalAvailable, pageNumber } = nextPagination);
    items.push(...nextData);
  }

  if (limit && limit < items.length) {
    items.length = limit;
  }

  return {
    items,
    totalAvailable,
    truncatedByLimit: totalAvailable > items.length,
  };
}

export async function paginate<T>(args: PaginateArgs<T>): Promise<Array<T>> {
  const { items } = await paginateWithMetadata(args);
  return items;
}

/**
 * Validation for {@link getPage} inputs. Both `pageNumber` and `limit`
 * must be positive when provided; `limit` additionally may not exceed
 * {@link MAX_PAGE_SIZE} since a single page can never return more than a full
 * server page. Mirrors the `.gt(0)` style used by {@link pageConfigSchema}.
 */
const getPageConfigSchema = z
  .object({
    pageNumber: z.coerce.number().gt(0),
    limit: z.coerce.number().gt(0).lte(MAX_PAGE_SIZE),
  })
  .partial();

type GetPageArgs<T> = {
  /** 1-based page number to fetch. Defaults to `1`. */
  pageNumber?: number;
  /** Per-page trim applied on top of the server cap. Must be `<= MAX_PAGE_SIZE`. */
  limit?: number;
  /**
   * Global offset ceiling across all pages (e.g. an admin `maxResultLimit`).
   * `null`/omitted means "no cap". Items whose absolute (0-based) offset is
   * `>= maxResultLimit` are trimmed off, so later pages can return fewer items
   * — or none at all — even though Tableau reports more `totalAvailable`.
   */
  maxResultLimit?: number | null;
  getDataFn: (page: {
    pageSize: number;
    pageNumber: number;
  }) => Promise<{ pagination: Pagination; data: Array<T> }>;
};

/**
 * Result of {@link getPage}: a single page's items plus the total the caller
 * should present.
 *
 * - `data` — the (possibly trimmed) items for the requested page.
 * - `totalAvailable` — `min(rawTotal, maxResultLimit)`; equal to the raw total
 *   Tableau reported when there is no cap. When a server-side `maxResultLimit`
 *   offset ceiling is in force, this is capped to it so the caller presents the
 *   number of items actually reachable rather than the uncapped server total.
 */
export type GetPageResult<T> = {
  data: Array<T>;
  totalAvailable: number;
};

/**
 * Fetch a SINGLE page (no looping). Unlike {@link paginate}, this issues
 * exactly one {@link getDataFn} call and returns just that page, applying an
 * optional global `maxResultLimit` offset ceiling and an optional per-page
 * `limit` trim.
 *
 * A full page (`MAX_PAGE_SIZE`) is always requested so absolute offsets stay
 * stable across pages regardless of the caller's `limit`. The absolute
 * (0-based) offset of the first item on the page is `(pageNumber - 1) *
 * MAX_PAGE_SIZE`; anything at or beyond `maxResultLimit` is dropped so the
 * cumulative number of items across all pages never exceeds the cap.
 */
export async function getPage<T>(args: GetPageArgs<T>): Promise<GetPageResult<T>> {
  // Validate caller-facing knobs (pageNumber/limit) up front, consistent with
  // the file's zod-based validation style. maxResultLimit is a server-provided
  // cap, not user input, so it is not validated here.
  getPageConfigSchema.parse({ pageNumber: args.pageNumber, limit: args.limit });

  // paging variables
  const pageNumber = args.pageNumber ?? 1;
  const pageSize = MAX_PAGE_SIZE; // always request full page for stable offsets

  // fetching page data
  const { pagination, data } = await args.getDataFn({ pageSize, pageNumber });
  const totalAvailable = pagination.totalAvailable;
  const totalItemsInPage = data.length;
  const maxResultLimit = args.maxResultLimit ?? null;
  const pageStartOffset = (pageNumber - 1) * pageSize; // 0-based abs index of first item on page
  // checks if the total items paged goes beyond the max result limits
  // and truncates results to fit the overall cap or evalutates to 0 for page numbers that go beyond cap.
  const serverAllowed =
    maxResultLimit == null
      ? totalItemsInPage
      : Math.max(0, Math.min(totalItemsInPage, maxResultLimit - pageStartOffset));
  // applies limit requested for this page
  const callerCap = args.limit != null ? Math.min(args.limit, serverAllowed) : serverAllowed;
  const trimmed = data.slice(0, callerCap);
  // Cap the reported total to the server-side offset ceiling so the caller
  // presents the number of items actually reachable, not the uncapped total.
  const cappedTotalAvailable =
    maxResultLimit == null ? totalAvailable : Math.min(totalAvailable, maxResultLimit);
  return { data: trimmed, totalAvailable: cappedTotalAvailable };
}

/**
 * Determine whether a 1-based `pageNumber` is reachable given an optional
 * `maxResultLimit` offset ceiling. A page is reachable iff the absolute
 * (0-based) offset of its first item — `(pageNumber - 1) * MAX_PAGE_SIZE` — is
 * below `maxResultLimit`. When there is no cap (`null`/omitted), every page is
 * reachable.
 *
 * This exists because {@link getPage} would otherwise fetch a full server page
 * for an out-of-range request and then trim every item off (its `serverAllowed`
 * collapses to `0`), surfacing a misleading "no results were found" message
 * even though `totalAvailable` is non-zero. Callers should run this check
 * first and short-circuit with a clear "page exceeds the limit" response.
 *
 * Example: with `maxResultLimit: 2700`, pages 1–3 are reachable (page 3 starts
 * at offset 2000 and returns 700 items), but page 4 (offset 3000) is not.
 *
 * @returns `null` when the page is reachable, or a human-readable message
 *   explaining the valid page range when it is not.
 */
export function getPageExceedsLimitMessage({
  pageNumber,
  maxResultLimit,
}: {
  pageNumber?: number;
  maxResultLimit?: number | null;
}): string | null {
  if (maxResultLimit == null) {
    return null;
  }

  const page = pageNumber ?? 1;
  const pageStartOffset = (page - 1) * MAX_PAGE_SIZE;
  if (pageStartOffset < maxResultLimit) {
    return null;
  }

  const maxReachablePage = Math.ceil(maxResultLimit / MAX_PAGE_SIZE);
  return (
    `The requested page (${page}) exceeds the response limit configured for this tool. ` +
    `A maximum of ${maxResultLimit} results can be paged through (in pages of ${MAX_PAGE_SIZE}), ` +
    `so the highest page you can request is ${maxReachablePage}.`
  );
}

const pulsePaginateConfigSchema = z
  .object({
    limit: z.coerce.number().gt(0).optional(),
    pageSize: z.coerce.number().gt(0).optional(),
  })
  .optional();

type PulsePaginateConfig = z.infer<typeof pulsePaginateConfigSchema>;

type PulsePaginateArgs<T> = {
  config: PulsePaginateConfig;
  getDataFn: (
    pageToken?: string,
    pageSize?: number,
  ) => Promise<PulseResult<{ pagination: PulsePagination; data: Array<T> }>>;
};

export async function pulsePaginate<T>({
  config,
  getDataFn,
}: PulsePaginateArgs<T>): Promise<PulseResult<Array<T>>> {
  const validatedConfig = pulsePaginateConfigSchema.parse(config);
  const limit = validatedConfig?.limit;
  let pageSize = validatedConfig?.pageSize;

  const result = await getDataFn(undefined, pageSize);
  if (result.isErr()) {
    return result;
  }
  const { pagination, data } = result.value;
  const resultArray = [...data];
  const total_available = pagination.total_available;

  let next_page_token = pagination.next_page_token;

  // If pageSize is not provided, set it to the minimum of the total available data and the remaining limit
  if (!pageSize && total_available) {
    pageSize = Math.min(
      total_available - resultArray.length,
      limit ? limit - resultArray.length : Number.MAX_SAFE_INTEGER,
    );
  }

  while (next_page_token && (!limit || limit > resultArray.length)) {
    const result = await getDataFn(next_page_token, pageSize);
    if (result.isErr()) {
      return result;
    }
    const { pagination: nextPagination, data: nextData } = result.value;

    if (nextData.length === 0) {
      throw new Error(`No more data available. Total fetched: ${resultArray.length}`);
    }

    ({ next_page_token } = nextPagination);
    resultArray.push(...nextData);
  }

  if (limit && limit < resultArray.length) {
    resultArray.length = limit;
  }

  return new Ok(resultArray);
}
