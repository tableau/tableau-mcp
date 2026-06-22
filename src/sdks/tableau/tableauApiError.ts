import { z } from 'zod';

import { isAxiosError } from '../../utils/axios.js';

/**
 * Tableau REST APIs return a structured error body of the shape
 * `{ error: { code, summary, detail } }` on most 4xx responses. Extracting that into a
 * normalized struct lets calling SDK methods surface actionable diagnostics (e.g. the
 * `409004 Invalid subscription schedule` reason from update-cloud-extract-refresh-task)
 * instead of the generic axios `Request failed with status code 400`.
 *
 * Returns `null` when the input isn't an axios error or the response body doesn't match
 * the expected shape; callers should fall back to `getExceptionMessage(error)` in that case.
 */
const tableauApiErrorBodySchema = z.object({
  error: z.object({
    code: z.string().optional(),
    summary: z.string().optional(),
    detail: z.string().optional(),
  }),
});

export type ParsedTableauApiError = {
  status: number;
  code?: string;
  summary?: string;
  detail?: string;
};

export function parseTableauApiError(error: unknown): ParsedTableauApiError | null {
  if (!isAxiosError(error) || !error.response) return null;
  const parsed = tableauApiErrorBodySchema.safeParse(error.response.data);
  if (!parsed.success) return null;
  return {
    status: error.response.status,
    ...parsed.data.error,
  };
}
