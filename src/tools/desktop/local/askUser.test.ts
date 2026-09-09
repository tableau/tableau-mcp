import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import {
  ASK_TOOL_META,
  utteranceToolMetaFromWire,
  utteranceToolMetaToWire,
  utteranceToWire,
} from '../utterance.js';
import { askUtteranceFromInput } from '../utteranceMark.js';
import { getAskUserTool } from './askUser.js';

describe('askUserTool', () => {
  it('should create a tool instance with correct properties', () => {
    const tool = getAskUserTool(new DesktopMcpServer());
    expect(tool.name).toBe('ask-user');
    expect(tool.title).toBe('Ask the User a Clarifying Question');
    expect(tool.description).toContain('Ask instead of guessing');
    expect(tool.paramsSchema).toMatchObject({
      question: expect.any(Object),
      urgency: expect.any(Object),
      options: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(tool.meta).toEqual({ utterance: utteranceToolMetaToWire(ASK_TOOL_META) });
    expect(utteranceToolMetaFromWire(tool.meta!.utterance).defaultKind).not.toBe('answer');
  });

  it('marks a blocking ask on the input rather than flattening markdown', async () => {
    const question = 'Which Sales field should I use?';
    const result = await getToolResult({ question });
    expect(result.isError).toBe(false);
    expect(JSON.parse(toolText(result))).toEqual({ question, urgency: 'blocking' });
    expect(utteranceOf(result)).toEqual(
      utteranceToWire(askUtteranceFromInput({ question, urgency: 'blocking' })),
    );
  });

  it('marks a soft ask as a proposal', async () => {
    const question = 'Should I use monthly grain?';
    const result = await getToolResult({ question, urgency: 'soft' });
    expect(utteranceOf(result)).toEqual(
      utteranceToWire(askUtteranceFromInput({ question, urgency: 'soft' })),
    );
  });

  it('puts options on the ask body instead of a numbered list', async () => {
    const question = 'Which field should I use?';
    const options = ['Sales', 'Profit', 'Revenue'];
    const result = await getToolResult({ question, options });
    expect(JSON.parse(toolText(result))).toEqual({
      question,
      urgency: 'blocking',
      options,
    });
    expect(toolText(result)).not.toContain('1. Sales');
    expect(utteranceOf(result)).toEqual(
      utteranceToWire(askUtteranceFromInput({ question, urgency: 'blocking', options })),
    );
  });

  it('rejects an empty question at the schema layer', async () => {
    const tool = getAskUserTool(new DesktopMcpServer());
    const schema = z.object(await Provider.from(tool.paramsSchema));

    expect(schema.safeParse({ question: '' }).success).toBe(false);
    expect(schema.safeParse({ question: 'Which field?' }).success).toBe(true);
  });
});

function utteranceOf(result: CallToolResult): unknown {
  return (result.structuredContent as { utterance?: unknown } | undefined)?.utterance;
}

function toolText(result: CallToolResult): string {
  invariant(result.content[0].type === 'text');
  return result.content[0].text;
}

async function getToolResult(args: {
  question: string;
  urgency?: 'blocking' | 'soft';
  options?: string[];
}): Promise<CallToolResult> {
  const tool = getAskUserTool(new DesktopMcpServer());
  const schema = z.object(await Provider.from(tool.paramsSchema));
  const parsed = schema.parse(args);
  const callback = await Provider.from(tool.callback);
  return await callback(
    { question: parsed.question, urgency: parsed.urgency, options: parsed.options },
    getMockRequestHandlerExtra(),
  );
}
