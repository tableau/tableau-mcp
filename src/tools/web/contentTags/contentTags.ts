import { z } from 'zod';

import {
  DatasourceNotAllowedError,
  McpToolError,
  ViewNotAllowedError,
  WorkbookNotAllowedError,
} from '../../../errors/mcpToolError.js';
import { encodeTagLabel } from '../../../sdks/tableau/methods/tagUtils.js';
import { PENDING_DELETION_TAG_PREFIX } from '../_lib/pendingDeletionTag.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { TableauWebRequestHandlerExtra } from '../toolContext.js';

// Operational tool caps, not Tableau API limits. Do not normalize labels sent to Tableau.
export const MAX_CONTENT_TAG_LABEL_LENGTH = 256;
export const MAX_CONTENT_TAG_ADDITIONS = 50;
export const contentTagResourceTypeSchema = z.enum(['workbook', 'view', 'datasource']);
export type ContentTagResourceType = z.infer<typeof contentTagResourceTypeSchema>;

function hasValidUnicode(label: string): boolean {
  try {
    encodeURIComponent(label);
    return true;
  } catch {
    return false;
  }
}

/** Rejection-only aliases for ambiguous server decoding; never rewrite a label sent to Tableau. */
function isReservedLifecycleLabel(label: string): boolean {
  let candidate = label;
  for (let pass = 0; pass <= 2; pass++) {
    if (candidate.trim().toLowerCase().startsWith(PENDING_DELETION_TAG_PREFIX)) return true;
    if (pass === 2) break;
    // The namespace is ASCII. Decode well-formed byte escapes only for this prefix check, retaining
    // malformed/literal percent text. Two passes match the existing route guard's threat ceiling.
    candidate = candidate.replace(/%([0-9a-f]{2})/gi, (_match, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
  }
  return false;
}

export const contentTagLabelSchema = z
  .string()
  .min(1)
  .max(MAX_CONTENT_TAG_LABEL_LENGTH, 'Tool limit: tag labels must not exceed 256 UTF-16 code units')
  .refine((label) => label.trim().length > 0, 'Tag labels must not be empty or whitespace-only')
  // ASCII controls are unsafe in paths and are not meaningful labels. Unicode is otherwise kept.
  .refine(
    (label) =>
      ![...label].some((char) => {
        const code = char.charCodeAt(0);
        return code < 32 || code === 127;
      }),
    'Tag labels must not contain ASCII controls',
  )
  .refine(hasValidUnicode, 'Tag labels must contain valid Unicode')
  .refine(
    (label) => !isReservedLifecycleLabel(label),
    'The pending-deletion namespace is reserved for the content lifecycle tools',
  );

export const removableContentTagLabelSchema = contentTagLabelSchema.refine((label) => {
  try {
    encodeTagLabel(label);
    return true;
  } catch {
    return false;
  }
}, 'This tool cannot remove labels containing path separators, traversal segments or unsafe percent-encoded sequences');

/** Check every target before entering a mutation session; a denied result always fails closed. */
export async function getContentTagAccessError(
  resourceType: ContentTagResourceType,
  resourceId: string,
  extra: TableauWebRequestHandlerExtra,
): Promise<McpToolError | undefined> {
  // The access checker spreads this request extra into each nested useRestApi call. Disable raw
  // REST notifications until authorization is known, so rejected metadata cannot leak at debug.
  // The original extra is retained by WebTool for normal invocation logging and telemetry.
  const probeExtra: TableauWebRequestHandlerExtra & { disableLogging: true } = {
    ...extra,
    disableLogging: true,
  };
  // Access-check failure messages can include malformed raw REST payloads. Return only a curated
  // boundary decision; callers must never learn metadata from a target that was not admitted.
  const denialMessage = `The ${resourceType} is not allowed by this MCP server's bounded context, or its access could not be verified.`;
  switch (resourceType) {
    case 'workbook': {
      const result = await resourceAccessChecker.isWorkbookAllowed({
        workbookId: resourceId,
        extra: probeExtra,
      });
      return result.allowed ? undefined : new WorkbookNotAllowedError(denialMessage);
    }
    case 'view': {
      const result = await resourceAccessChecker.isViewAllowed({
        viewId: resourceId,
        extra: probeExtra,
      });
      return result.allowed ? undefined : new ViewNotAllowedError(denialMessage);
    }
    case 'datasource': {
      const result = await resourceAccessChecker.isDatasourceAllowed({
        datasourceLuid: resourceId,
        extra: probeExtra,
      });
      return result.allowed ? undefined : new DatasourceNotAllowedError(denialMessage);
    }
  }
}
