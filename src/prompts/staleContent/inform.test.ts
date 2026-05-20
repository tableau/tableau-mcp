import { WebMcpServer } from '../../server.web.js';
import { getStaleContentCleanupInformPrompt } from './inform.js';

describe('stale-content-cleanup-inform prompt', () => {
  it('registers under the documented name', () => {
    const prompt = getStaleContentCleanupInformPrompt(new WebMcpServer());
    expect(prompt.name).toBe('stale-content-cleanup-inform');
  });

  it('is enabled only when adminToolsEnabled is true', () => {
    const prompt = getStaleContentCleanupInformPrompt(new WebMcpServer());

    expect(prompt.enabled({ adminToolsEnabled: true } as any)).toBe(true);

    expect(prompt.enabled({ adminToolsEnabled: false } as any)).toBe(false);
  });

  it('instructs the model to call get-stale-content-report once and forbid recomputation', async () => {
    const prompt = getStaleContentCleanupInformPrompt(new WebMcpServer());
    const result = await prompt.callback({});
    expect(result.messages).toHaveLength(1);
    const message = result.messages[0];
    expect(message.role).toBe('user');
    if (message.content.type !== 'text') {
      throw new Error('expected text content');
    }
    const { text } = message.content;
    expect(text).toContain('`get-stale-content-report`');
    expect(text).toContain('exactly once');
    expect(text).toContain('Do **not** recompute');
    expect(text).toContain('"minAgeDays": 90');
    expect(text).not.toContain('Compute `days_stale');
  });

  it('passes minAgeDays through to the tool args block', async () => {
    const prompt = getStaleContentCleanupInformPrompt(new WebMcpServer());
    const result = await prompt.callback({ minAgeDays: '30' });
    if (result.messages[0].content.type !== 'text') {
      throw new Error('expected text content');
    }
    expect(result.messages[0].content.text).toContain('"minAgeDays": 30');
  });

  it('emits projectIds in the tool args when provided', async () => {
    const prompt = getStaleContentCleanupInformPrompt(new WebMcpServer());
    const result = await prompt.callback({ projectIds: 'p-1, p-2' });
    if (result.messages[0].content.type !== 'text') {
      throw new Error('expected text content');
    }
    const { text } = result.messages[0].content;
    expect(text).toContain('"projectIds"');
    expect(text).toContain('p-1');
    expect(text).toContain('p-2');
  });

  it('omits projectIds from tool args when not provided', async () => {
    const prompt = getStaleContentCleanupInformPrompt(new WebMcpServer());
    const result = await prompt.callback({});
    if (result.messages[0].content.type !== 'text') {
      throw new Error('expected text content');
    }
    expect(result.messages[0].content.text).not.toContain('"projectIds"');
  });
});
