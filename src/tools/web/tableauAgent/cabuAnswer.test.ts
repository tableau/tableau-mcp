import { CabuResponseCompleteEvent } from '../../../sdks/tableau/types/cabu.js';
import { buildCabuAnswer } from './cabuAnswer.js';

describe('buildCabuAnswer', () => {
  it('assembles response text, dataDetails, and nextParentLuid from a response_complete event', () => {
    const event: CabuResponseCompleteEvent = {
      node: 'response',
      response: 'Sales were highest in the West region.',
      dataDetails: 'Showing SUM(Sales) by Region.',
      chatLuid: 'chat-luid-1',
    };

    expect(buildCabuAnswer(event)).toEqual({
      response: 'Sales were highest in the West region.',
      datatables: undefined,
      dataDetails: 'Showing SUM(Sales) by Region.',
      nextParentLuid: 'chat-luid-1',
    });
  });

  it('renders a row-object datatable as a markdown table', () => {
    const event: CabuResponseCompleteEvent = {
      node: 'response',
      response: 'Here is the breakdown.',
      datatables: [
        {
          name: 'Sales by Region',
          data: [
            { Region: 'West', Sales: 1000 },
            { Region: 'East', Sales: 800 },
          ],
        },
      ],
    };

    const answer = buildCabuAnswer(event);
    expect(answer.datatables).toHaveLength(1);
    expect(answer.datatables?.[0]).toContain('Sales by Region');
    expect(answer.datatables?.[0]).toContain('| Region | Sales |');
    expect(answer.datatables?.[0]).toContain('| West | 1000 |');
    expect(answer.datatables?.[0]).toContain('| East | 800 |');
  });

  it('escapes pipes and collapses newlines in a cell value so they cannot corrupt the table', () => {
    const event: CabuResponseCompleteEvent = {
      node: 'response',
      datatables: [
        {
          name: 'Notes',
          data: [{ Region: 'West', Note: 'Line one|with a pipe\nLine two\r\nLine three' }],
        },
      ],
    };

    const answer = buildCabuAnswer(event);
    expect(answer.datatables?.[0]).toContain(
      '| West | Line one\\|with a pipe Line two Line three |',
    );
  });

  it('truncates a row-object datatable beyond the row cap and notes the truncation', () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ Region: `Region ${i}`, Sales: i }));
    const event: CabuResponseCompleteEvent = {
      node: 'response',
      datatables: [{ name: 'Big Table', data: rows }],
    };

    const answer = buildCabuAnswer(event);
    expect(answer.datatables?.[0]).toContain('Region 19');
    expect(answer.datatables?.[0]).not.toContain('Region 20');
    expect(answer.datatables?.[0]).toMatch(/truncated to 20 of 25 rows/);
  });

  it('falls back to a truncated JSON block for a non-row-object datatable shape', () => {
    const event: CabuResponseCompleteEvent = {
      node: 'response',
      datatables: [{ name: 'Scalar Table', data: 'a bare string, not rows' }],
    };

    const answer = buildCabuAnswer(event);
    expect(answer.datatables?.[0]).toContain('Scalar Table');
    expect(answer.datatables?.[0]).toContain('a bare string, not rows');
  });

  it('returns an empty-ish answer when the event has no content at all', () => {
    const event: CabuResponseCompleteEvent = { node: 'response' };

    expect(buildCabuAnswer(event)).toEqual({
      response: undefined,
      datatables: undefined,
      dataDetails: undefined,
      nextParentLuid: undefined,
    });
  });
});
