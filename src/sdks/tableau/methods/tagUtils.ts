import { z } from 'zod';

import { assertSafePathSegment, RouteSafetyError } from '../../routeSafety/core.js';
import { tagsSchema } from '../types/tags.js';

const tagMutationResponseSchema = z.object({ tags: tagsSchema });

export class TagMutationResponseError extends Error {
  constructor() {
    super(
      "Tableau returned an invalid tag-mutation response. The change may already have been applied. Read the resource's tags to verify before retrying.",
    );
  }
}

/** Recheck even when Zodios skips validation due to a missing/misreported response Content-Type. */
export function assertTagMutationResponse(response: unknown): void {
  if (!tagMutationResponseSchema.safeParse(response).success) {
    throw new TagMutationResponseError();
  }
}

/** The documented tag-delete response has no body; axios may represent it as undefined or ''. */
export function assertEmptyTagMutationResponse(response: unknown): void {
  if (response !== undefined && response !== null && response !== '') {
    throw new TagMutationResponseError();
  }
}

/**
 * Encode a decoded tag label exactly once for the REST tag-delete path. Zodios interpolates path
 * params verbatim. Match TSC's quote(tag, safe='') and retain all existing route guards.
 * Encoded separators, traversal segments, controls and excessively encoded labels remain blocked.
 */
export function encodeTagLabel(tagLabel: string): string {
  if (typeof tagLabel !== 'string') {
    throw new RouteSafetyError('Tag label must be a string');
  }
  let encoded: string;
  try {
    encoded = encodeURIComponent(tagLabel).replace(
      /[!'()*]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  } catch {
    throw new RouteSafetyError('Tag label must contain valid Unicode');
  }
  return assertSafePathSegment('tagName', encoded);
}
