import { McpToolError } from '../../errors/mcpToolError.js';
import { type StructuredContent, type StructuredResult } from './structuredContent.js';

/**
 * Signals that a multi-step operation did not fully complete while preserving
 * the complete machine-readable recovery payload in the MCP error body.
 */
export class IncompleteOperationError<T extends object> extends McpToolError {
  readonly structuredContent?: StructuredContent;
  private readonly recoveryPayload: StructuredResult<T>;

  constructor(recoveryPayload: StructuredResult<T>) {
    super({
      type: 'incomplete-operation',
      message: 'The requested operation did not complete.',
      statusCode: 409,
    });
    this.recoveryPayload = recoveryPayload;
    this.structuredContent = recoveryPayload.structuredContent;
  }

  override getErrorText(): string {
    const { structuredContent: _, ...body } = this.recoveryPayload;
    return JSON.stringify(body);
  }
}
