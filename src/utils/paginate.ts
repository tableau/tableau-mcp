import { z } from 'zod';

import { Pagination } from '../sdks/tableau/types/pagination.js';

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
  pageConfigSchema.parse(pageConfig);

  const { pageSize, limit } = pageConfig;
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
      throw new Error('No more data available');
    }

    ({ totalAvailable, pageNumber } = nextPagination);
    result.push(...nextData);
  }

  if (limit && limit < result.length) {
    result.length = limit;
  }

  return result;
}
