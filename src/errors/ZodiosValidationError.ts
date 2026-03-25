import { ZodiosError } from '@zodios/core';
import { fromError } from 'zod-validation-error/v3';

import { McpToolError } from './McpToolError.js';

export class ZodiosValidationError extends McpToolError {
  constructor(error: ZodiosError) {
    super(
      'zodios-error',
      error.message,
      400,
      undefined,
      error.data?.toString(),
      fromError(error.cause).toString(),
    );
  }
}
