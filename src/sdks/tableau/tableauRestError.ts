/**
 * A Tableau REST error that arrived inside an otherwise-successful (2xx)
 * response body rather than as a non-2xx HTTP status.
 *
 * Some Tableau flow endpoints (observed on Cancel Flow Run) return HTTP 200
 * with a body of `{ "error": { code, summary, detail } }` for domain failures
 * such as "flow run already complete" (code 403135), instead of the documented
 * non-2xx status. Axios does not throw on a 2xx, so the SDK method detects the
 * envelope and throws this error to funnel those cases through the same
 * `getHttpStatus` / error-mapping path as real axios errors.
 *
 * `statusCode` is derived from the numeric Tableau error code prefix (e.g.
 * `403135` -> `403`) so downstream mappers can branch on status uniformly.
 */
export class TableauRestError extends Error {
  readonly tableauError: { code?: string; summary?: string; detail?: string };
  readonly statusCode: string;

  constructor(tableauError: { code?: string; summary?: string; detail?: string }) {
    const code = tableauError.code;
    const statusCode = code && code.length >= 3 ? code.slice(0, 3) : '400';
    super(`Tableau${code ? ` [${code}]` : ''}: ${tableauError.summary ?? 'request failed'}`);
    this.name = 'TableauRestError';
    this.tableauError = tableauError;
    this.statusCode = statusCode;
  }
}
