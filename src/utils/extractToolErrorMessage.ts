import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Extracts a human-readable error message from a failed tool result's text
 * content, so it can be forwarded as telemetry detail. Joins all text blocks
 * and returns an empty string when the result carries no usable text.
 */
export function extractToolErrorMessage(result: CallToolResult): string {
  const content = result.content;
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .filter((item): item is { type: 'text'; text: string } => item?.type === 'text')
    .map((item) => item.text)
    .join(' ')
    .trim();
}
