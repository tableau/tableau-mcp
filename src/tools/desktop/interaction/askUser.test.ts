import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
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
      title: 'Ask the User a Clarifying Question',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('defaults to blocking urgency', async () => {
    const text = await getToolText({ question: 'Which Sales field should I use?' });
    expect(text).toBe('[BLOCKING] Which Sales field should I use?');
  });

  it('renders soft urgency', async () => {
    const text = await getToolText({
      question: 'Should I use monthly grain?',
      urgency: 'soft',
    });
    expect(text).toBe('[SOFT] Should I use monthly grain?');
  });

  it('renders options as a numbered list', async () => {
    const text = await getToolText({
      question: 'Which field should I use?',
      options: ['Sales', 'Profit', 'Revenue'],
    });
    expect(text).toBe(
      '[BLOCKING] Which field should I use?\n\nOptions:\n1. Sales\n2. Profit\n3. Revenue',
    );
  });

  it('rejects an empty question at the schema layer', async () => {
    const tool = getAskUserTool(new DesktopMcpServer());
    const schema = z.object(await Provider.from(tool.paramsSchema));

    expect(schema.safeParse({ question: '' }).success).toBe(false);
    expect(schema.safeParse({ question: 'Which field?' }).success).toBe(true);
  });
});

async function getToolText(args: {
  question: string;
  urgency?: 'blocking' | 'soft';
  options?: string[];
}): Promise<string> {
  const result = await getToolResult(args);
  expect(result.isError).toBe(false);
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
