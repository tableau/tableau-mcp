import { z } from 'zod';

export const paginationSchema = z.object({
  pageNumber: z.coerce.number(),
  pageSize: z.coerce.number(),
  totalAvailable: z.coerce.number(),
});

export type Pagination = z.infer<typeof paginationSchema>;
