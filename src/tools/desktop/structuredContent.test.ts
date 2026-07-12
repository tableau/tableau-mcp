import {
  jsonToolResult,
  prefillNextAction,
  textToolResult,
  withNextAction,
} from './structuredContent.js';

describe('structuredContent helpers', () => {
  it('preserves the plain text MCP envelope when there is no next action', () => {
    expect(textToolResult('hello')).toEqual({
      content: [{ type: 'text', text: 'hello' }],
    });
  });

  it('emits exactly one structured nextAction without changing JSON text', () => {
    const body = { applied: false, guidance: 'Resolve the fields first.' };
    const result = jsonToolResult(
      withNextAction(body, prefillNextAction('Resolve the fields first')),
      { isError: false },
    );

    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(body) }]);
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({
      nextAction: { label: 'Resolve the fields first', kind: 'prefill' },
    });
    expect(Object.keys(result.structuredContent!)).toEqual(['nextAction']);
  });

  it('rejects labels over 60 characters', () => {
    expect(() => prefillNextAction('x'.repeat(61))).toThrow('nextAction label');
  });
});
