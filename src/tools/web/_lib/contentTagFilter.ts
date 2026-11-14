import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { ArgsValidationError, McpToolError } from '../../../errors/mcpToolError.js';
import { splitTopLevel } from '../../../utils/parseAndValidateFilterString.js';

/** Typed convenience input for the existing list tools' documented tags:eq / tags:in filters. */
export const contentTagSearchLabelsSchema = z
  .array(
    z
      .string()
      .min(1)
      .max(256, 'Tool limit: at most 256 UTF-16 code units per search label')
      .refine(
        (label) => label.trim().length > 0 && label.trim() === label,
        'Tag-search labels must be non-empty without surrounding whitespace',
      )
      .refine(
        (label) => !['&', ',', '[', ']'].some((delimiter) => label.includes(delimiter)),
        'Tag-search labels cannot contain &, comma or brackets in Tableau filter expressions',
      )
      .refine(
        (label) => !/%[0-9a-f]{2}/i.test(label),
        'Pass decoded tag-search labels; literal percent-escape sequences are unsupported by this tool',
      )
      .refine((label) => {
        if ([...label].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
          return false;
        }
        try {
          encodeURIComponent(label);
          return true;
        } catch {
          return false;
        }
      }, 'Tag-search labels must contain valid Unicode without ASCII controls'),
  )
  .min(1)
  .max(50, 'Tool limit: at most 50 tag-search labels per call');

export const contentTagSearchDescription =
  'For tag-only discovery, pass tagLabels: ["Sales"] for an exact, case-sensitive tag match, or ' +
  'tagLabels: ["Sales", "Finance"] to match ANY listed tag (OR). This is not an all-tags (AND) search. ' +
  'Other filter fields are combined with the tag condition using AND. Do not also pass a tags clause in filter. ' +
  'Tool limits: 1–50 decoded labels, at most 256 UTF-16 code units each; no &, comma, brackets, percent-escape sequences, ASCII controls or surrounding whitespace. ' +
  'Use the existing pageNumber/limit parameters and observe bounded-context filtering.';

/**
 * Build a decoded filter value; axios encodes it as a query parameter. The native `in` operator
 * implements OR, and repeated tags fields are last-one-wins, never an implicit all-tags AND.
 * Reserved cleanup labels may be searched: only generic mutations reserve their namespace.
 */
export function withContentTagFilter(
  filter?: string,
  tagLabels?: string[],
): Result<string | undefined, McpToolError> {
  if (tagLabels === undefined) return new Ok(filter);
  const parsed = contentTagSearchLabelsSchema.safeParse(tagLabels);
  if (!parsed.success) return new ArgsValidationError(parsed.error.message).toErr();
  if (filter && splitTopLevel(filter, ',').some((expr) => expr.trim().split(':')[0] === 'tags')) {
    return new ArgsValidationError('Use tagLabels or a tags clause in filter, not both.').toErr();
  }
  const labels = [...new Set(parsed.data)];
  const tagFilter = labels.length === 1 ? `tags:eq:${labels[0]}` : `tags:in:[${labels.join(',')}]`;
  return new Ok(filter?.trim() ? `${filter},${tagFilter}` : tagFilter);
}
