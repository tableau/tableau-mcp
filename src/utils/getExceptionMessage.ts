import { ZodiosError } from '@zodios/core';
import { fromError, isZodErrorLike } from 'zod-validation-error';

export function getExceptionMessage(error: unknown): string {
  if (error instanceof ZodiosError && isZodErrorLike(error.cause)) {
    return fromError(error.cause).toString();
  }

  if (error instanceof Error) {
    return error.message;
  }

  try {
    return JSON.stringify(error) ?? 'undefined';
  } catch {
    return `${error}`;
  }
}
