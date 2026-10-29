import { ZodiosError } from '@zodios/core';

import { McpToolError } from '../../../errors/mcpToolError.js';
import { TagMutationResponseError } from '../../../sdks/tableau/methods/tagUtils.js';
import { getHttpStatus } from '../../../utils/getHttpStatus.js';

/**
 * Zodios schema failures embed the raw response in their message. Keep that response out of the
 * client-facing error funnel, where bounded-context filtering has not necessarily run yet.
 * Preserve HTTP/auth and route errors. A mutation may have applied before response validation.
 */
export async function withContentTagResponseValidation<T>(
  callback: () => Promise<T>,
  mutation = false,
): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    if (
      !(error instanceof TagMutationResponseError) &&
      (!(error instanceof ZodiosError) || getHttpStatus(error))
    )
      throw error;
    throw new McpToolError({
      type: mutation ? 'tag-mutation-result-unverified' : 'invalid-content-response',
      statusCode: 502,
      message: mutation
        ? "Tableau returned an invalid tag-mutation response. The change may already have been applied. Read the resource's tags to verify before retrying."
        : 'Tableau returned an invalid content response. Tag search results could not be verified.',
    });
  }
}
