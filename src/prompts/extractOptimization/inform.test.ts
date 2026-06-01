import { WebMcpServer } from '../../server.web.js';
import { getExtractOptimizationInformPrompt } from './inform.js';

describe('extract-optimization-inform prompt', () => {
  it('registers under the documented name', () => {
    const prompt = getExtractOptimizationInformPrompt(new WebMcpServer());
    expect(prompt.name).toBe('extract-optimization-inform');
  });

  it('is disabled when adminToolsEnabled is false', () => {
    const prompt = getExtractOptimizationInformPrompt(new WebMcpServer());

    expect(prompt.disabled({ adminToolsEnabled: true } as any)).toBe(false);

    expect(prompt.disabled({ adminToolsEnabled: false } as any)).toBe(true);
  });

  it('instructs the model to call list-extract-refresh-tasks once', async () => {
    const prompt = getExtractOptimizationInformPrompt(new WebMcpServer());
    const result = await prompt.callback({});
    expect(result.messages).toHaveLength(1);
    const message = result.messages[0];
    expect(message.role).toBe('user');
    if (message.content.type !== 'text') {
      throw new Error('expected text content');
    }
    const { text } = message.content;
    expect(text).toContain('`list-extract-refresh-tasks`');
    expect(text).toContain('exactly once');
    expect(text).toContain('Extract optimization report');
  });

  it('emits filter in the tool args when projectIds are provided', async () => {
    const prompt = getExtractOptimizationInformPrompt(new WebMcpServer());
    const result = await prompt.callback({ projectIds: 'p-1, p-2' });
    if (result.messages[0].content.type !== 'text') {
      throw new Error('expected text content');
    }
    const { text } = result.messages[0].content;
    expect(text).toContain('"filter"');
    expect(text).toContain('p-1');
    expect(text).toContain('p-2');
  });

  it('omits filter from tool args when projectIds are not provided', async () => {
    const prompt = getExtractOptimizationInformPrompt(new WebMcpServer());
    const result = await prompt.callback({});
    if (result.messages[0].content.type !== 'text') {
      throw new Error('expected text content');
    }
    expect(result.messages[0].content.text).not.toContain('"filter"');
  });
});
