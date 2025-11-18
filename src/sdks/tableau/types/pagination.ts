import { z } from 'zod';

export const paginationSchema = z.object({
  pageNumber: z.coerce.number(),
  pageSize: z.coerce.number(),
  totalAvailable: z.coerce.number(),
});

export type Pagination = z.infer<typeof paginationSchema>;

export const pulsePaginationSchema = z.object({
  next_page_token: z.string().optional(),
});

export type PulsePagination = z.infer<typeof pulsePaginationSchema>;
