import { fromError } from 'zod-validation-error/v4';

// zod-validation-error v4 capitalizes every issue message by default, which turns our own messages
// into e.g. "Client_id is required". Keep them as written, as they were before zod 4.
export function formatZodError(error: unknown): string {
  return fromError(error, { forceTitleCase: false }).toString();
}
