import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { extractToolErrorMessage } from './extractToolErrorMessage.js';

describe('extractToolErrorMessage', () => {
  it('returns the text of a single text content block', () => {
    const result: CallToolResult = {
      isError: true,
      content: [{ type: 'text', text: 'Request failed with status code 404' }],
    };

    expect(extractToolErrorMessage(result)).toBe('Request failed with status code 404');
  });

  it('joins multiple text blocks with a space', () => {
    const result: CallToolResult = {
      isError: true,
      content: [
        { type: 'text', text: 'first' },
        { type: 'text', text: 'second' },
      ],
    };

    expect(extractToolErrorMessage(result)).toBe('first second');
  });

  it('ignores non-text content blocks', () => {
    const result = {
      isError: true,
      content: [
        { type: 'image', data: 'abc', mimeType: 'image/png' },
        { type: 'text', text: 'only this' },
      ],
    } as unknown as CallToolResult;

    expect(extractToolErrorMessage(result)).toBe('only this');
  });

  it('returns an empty string when there are no text blocks', () => {
    const result = {
      isError: true,
      content: [{ type: 'image', data: 'abc', mimeType: 'image/png' }],
    } as unknown as CallToolResult;

    expect(extractToolErrorMessage(result)).toBe('');
  });

  it('returns an empty string when the text is empty or whitespace only', () => {
    const result: CallToolResult = {
      isError: true,
      content: [{ type: 'text', text: '   ' }],
    };

    expect(extractToolErrorMessage(result)).toBe('');
  });

  it('returns an empty string when content is not an array', () => {
    const result = { isError: true, content: undefined } as unknown as CallToolResult;

    expect(extractToolErrorMessage(result)).toBe('');
  });
});
