import { z } from 'zod';

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

export async function paginate<T>({ pageConfig, getDataFn }: PaginateArgs<T>): Promise<Array<T>> {
  const { pageSize, limit } = pageConfigSchema.parse(pageConfig);
  const { pagination, data } = await getDataFn(pageConfig);
  const result = [...data];

  let { totalAvailable, pageNumber } = pagination;
  while (totalAvailable > result.length && (!limit || limit > result.length)) {
    const { pagination: nextPagination, data: nextData } = await getDataFn({
      pageSize,
      pageNumber: pageNumber + 1,
      limit,
    });

    if (nextData.length === 0) {
      throw new Error(
        `No more data available. Last fetched page number: ${pageNumber}, Total available: ${totalAvailable}, Total fetched: ${result.length}`,
      );
    }

    ({ totalAvailable, pageNumber } = nextPagination);
    result.push(...nextData);
  }

  if (limit && limit < result.length) {
    result.length = limit;
  }

  return result;
}

const pulsePaginateConfigSchema = z
  .object({
    limit: z.coerce.number().gt(0).optional(),
  })
  .optional();

type PulsePaginateConfig = z.infer<typeof pulsePaginateConfigSchema>;

type PulsePaginateArgs<T> = {
  config: PulsePaginateConfig;
  getDataFn: (pageToken?: string) => Promise<{ pagination: PulsePagination; data: Array<T> }>;
};

export async function pulsePaginate<T>({ config, getDataFn }: PulsePaginateArgs<T>): Promise<Array<T>> {
  const limit = config?.limit;
  const { pagination, data } = await getDataFn();
  const result = [...data];
  
  let { next_page_token } = pagination;
  while (next_page_token && (!limit || limit > result.length)) {
    const { pagination: nextPagination, data: nextData } = await getDataFn(next_page_token);

    if (nextData.length === 0) {
      throw new Error(
        `No more data available. Total fetched: ${result.length}`,
      );
    }

    ({ next_page_token } = nextPagination);
    result.push(...nextData);
  }

  if (limit && limit < result.length) {
    result.length = limit;
  }

  return result;
}
