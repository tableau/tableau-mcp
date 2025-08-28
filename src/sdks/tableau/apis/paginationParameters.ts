import { ZodiosEndpointParameter } from '@zodios/core';
import { z } from 'zod';

export const paginationParameters = [
  {
    name: 'pageSize',
    type: 'Query',
    schema: z.number().optional(),
    description:
      'The number of items to return in one response. The minimum is 1. The maximum is 1000. The default is 100.',
  },
  {
    name: 'pageNumber',
    type: 'Query',
    schema: z.number().optional(),
    description: 'The offset for paging. The default is 1.',
  },
] as const satisfies Array<ZodiosEndpointParameter>;
