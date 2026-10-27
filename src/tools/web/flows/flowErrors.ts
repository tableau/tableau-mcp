import { TableauRestError } from '../../../sdks/tableau/tableauRestError.js';
import { isAxiosError } from '../../../utils/axios.js';

/** Extracts Tableau's structured error envelope, including one returned in a 2xx response. */
export function extractTableauError(
  error: unknown,
): { code?: string; summary?: string; detail?: string } | null {
  if (error instanceof TableauRestError) {
    return error.tableauError;
  }
  const axiosError = isAxiosError(error)
    ? error
    : error instanceof Error && isAxiosError(error.cause)
      ? error.cause
      : undefined;
  if (!axiosError) {
    return null;
  }
  const tableauError = (axiosError.response?.data as { error?: unknown } | undefined)?.error as
    | {
        code?: string;
        summary?: string;
        detail?: string;
      }
    | undefined;
  if (tableauError && (tableauError.summary || tableauError.code)) {
    return tableauError;
  }
  return null;
}

/** Format `{ code, summary, detail }` as `Tableau [code]: summary: detail`. */
export function formatTableauError(t: {
  code?: string;
  summary?: string;
  detail?: string;
}): string {
  const head = `Tableau${t.code ? ` [${t.code}]` : ''}`;
  const body = t.detail && t.summary ? `${t.summary}: ${t.detail}` : t.summary || t.detail || '';
  return body ? `${head}: ${body}` : head;
}
