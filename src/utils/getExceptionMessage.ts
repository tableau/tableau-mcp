export function getExceptionMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  try {
    return JSON.stringify(error) ?? 'undefined';
  } catch {
    return `${error}`;
  }
}
