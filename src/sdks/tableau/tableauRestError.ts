/** Carries a Tableau error envelope returned in a 2xx response for normal error handling. */
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
