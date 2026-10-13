import { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z, ZodRawShape } from 'zod';

import { ExchangeUnavailableError } from '../../errors/mcpToolError.js';
import { ExchangeMcpServer } from '../../server.exchange.js';
import { LogAndExecuteParams, Tool, ToolParams } from '../tool.js';
import { TableauExchangeRequestHandlerExtra, TableauExchangeToolCallback } from './toolContext.js';
import { ExchangeToolName } from './toolName.js';

export const exchangeAnnotations: Required<ToolAnnotations> = {
  title: 'Read Tableau Exchange catalog',
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export class ExchangeTool<Args extends ZodRawShape> extends Tool<
  ExchangeMcpServer,
  ExchangeToolName,
  TableauExchangeRequestHandlerExtra,
  TableauExchangeToolCallback<Args>,
  Args
> {
  readonly outputSchema: ZodRawShape;
  constructor(
    params: ToolParams<
      ExchangeMcpServer,
      ExchangeToolName,
      TableauExchangeRequestHandlerExtra,
      TableauExchangeToolCallback<Args>,
      Args
    > & { outputSchema: ZodRawShape },
  ) {
    super(params);
    this.outputSchema = params.outputSchema;
  }

  override notifyInvocation({
    requestId,
    args,
  }: Parameters<
    Tool<
      ExchangeMcpServer,
      ExchangeToolName,
      TableauExchangeRequestHandlerExtra,
      TableauExchangeToolCallback<Args>,
      Args
    >['notifyInvocation']
  >[0]): void {
    const input: unknown = args;
    const queryLength =
      input && typeof input === 'object' && 'query' in input && typeof input.query === 'string'
        ? input.query.length
        : undefined;
    // The shared notifier sees metrics only, never the query, publisher or tag values.
    super.notifyInvocation({ requestId, args: { queryLength } });
  }

  async logAndExecute<T>({
    extra,
    args,
    callback,
  }: LogAndExecuteParams<
    T,
    ExchangeMcpServer,
    TableauExchangeRequestHandlerExtra,
    Args
  >): Promise<CallToolResult> {
    this.notifyInvocation({ requestId: extra.requestId, args });
    try {
      const result = await callback();
      if (result.isErr())
        return { isError: true, content: [{ type: 'text', text: result.error.getErrorText() }] };
      const parsed = z.object(this.outputSchema).strict().safeParse(result.value);
      if (!parsed.success) throw new ExchangeUnavailableError();
      return {
        isError: false,
        structuredContent: parsed.data,
        content: [{ type: 'text', text: JSON.stringify(parsed.data) }],
      };
    } catch {
      return {
        isError: true,
        content: [{ type: 'text', text: new ExchangeUnavailableError().getErrorText() }],
      };
    }
  }
}
