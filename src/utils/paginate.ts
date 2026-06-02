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
};

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
 *   we run it's stable.
 * - `truncatedByLimit` — `true` iff `items.length < totalAvailable`. When
 *   `true`, the caller can confidently surface a "more results available,
 *   but a limit cut you off" signal (e.g. an MCP warning).
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
}: PaginateArgs<T>): Promise<PaginateResult<T>> {
  const { pageSize, limit } = pageConfigSchema.parse(pageConfig);
  const { pagination, data } = await getDataFn(pageConfig);
  const items = [...data];

  let { totalAvailable, pageNumber } = pagination;
  while (totalAvailable > items.length && (!limit || limit > items.length)) {
    const { pagination: nextPagination, data: nextData } = await getDataFn({
      pageSize,
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
