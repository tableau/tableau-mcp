import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { useMemo } from 'react';
import type { z } from 'zod';

function extractTextContent(callToolResult: CallToolResult): string {
  const textContent = callToolResult.content?.find((c) => c.type === 'text');
  return textContent?.text ?? '';
}

export type UseToolResultSuccess<T> = { success: true; data: T };
export type UseToolResultError = { success: false; error: z.ZodError | Error };

export type UseToolResultReturn<T> = UseToolResultSuccess<T> | UseToolResultError;

/**
 * Parses a CallToolResult's text content with the given zod schema.
 * Returns the inferred data on success, or an error object when toolResult is null,
 * JSON is invalid, or schema validation fails.
 */
export function useToolResult<Schema extends z.ZodTypeAny>(
  toolResult: CallToolResult | null,
  schema: Schema,
): UseToolResultReturn<z.infer<Schema>> {
  return useMemo((): UseToolResultReturn<z.infer<Schema>> => {
    const content = toolResult ? extractTextContent(toolResult) : '{}';
    try {
      const json = JSON.parse(content || '{}') as unknown;
      const result = schema.safeParse(json);
      if (result.success) {
        return { success: true, data: result.data };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e : new Error(String(e)),
      };
    }
  }, [toolResult, schema]);
}
