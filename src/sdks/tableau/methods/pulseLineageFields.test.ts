import { z } from 'zod';

import { dataLineageParams } from '../types/dataLineage.js';
import { DataLineageTraversal, LineageWireNode } from './dataLineage.js';

const ds = '11111111-1111-4111-8111-111111111111';
const owner = { id: 'datasource', __typename: 'PublishedDatasource', luid: ds };
const makeField = (id: string, name: string): LineageWireNode => ({
  id,
  name,
  __typename: 'ColumnField',
  datasource: owner,
});
const page = (nodes: unknown[], next = false, cursor: string | null = null): object => ({
  nodes,
  pageInfo: { hasNextPage: next, endCursor: cursor },
});
const options = z.object(dataLineageParams).parse({ source: { type: 'field', id: 'f' } });

describe('Pulse scoped field lookup', () => {
  it('quotes field selectors as GraphQL literals and never joins against a global caption', async () => {
    const selector = 'B" } query Private { field';
    const graphql = vi.fn().mockResolvedValue({
      data: { asset: page([{ ...owner, pulseFields: page([makeField('f', selector)]) }]) },
    });
    const traversal = new DataLineageTraversal(options, {
      graphql,
      isAllowed: async () => true,
      prepEnabled: true,
    });
    expect((await traversal.lookupPulseField(ds, selector))?.id).toBe('f');
    expect(graphql.mock.calls[0][0]).toContain(`filter: { name: ${JSON.stringify(selector)} }`);
    expect(graphql.mock.calls[0][0]).toContain(`filter: { luid: ${JSON.stringify(ds)} }`);
    expect(graphql.mock.calls[0][0]).toContain('permissionMode: FILTER_RESULTS');
    await traversal.lookupPulseField(ds, selector);
    expect(graphql).toHaveBeenCalledOnce();
  });
  it('requires all candidate pages and refuses an incomplete or ambiguous set', async () => {
    for (const variant of ['unique', 'ambiguous', 'null'] as const) {
      const graphql = vi
        .fn()
        .mockResolvedValueOnce({
          data: {
            asset: page([{ ...owner, pulseFields: page([makeField('f', 'B')], true, 'next') }]),
          },
        })
        .mockResolvedValueOnce({
          data: {
            asset: page([
              {
                ...owner,
                pulseFields: page(
                  variant === 'unique'
                    ? []
                    : variant === 'null'
                      ? [null]
                      : [makeField('other', 'B')],
                ),
              },
            ]),
          },
        });
      const traversal = new DataLineageTraversal(options, {
        graphql,
        isAllowed: async () => true,
        prepEnabled: true,
      });
      expect((await traversal.lookupPulseField(ds, 'B'))?.id).toBe(
        variant === 'unique' ? 'f' : undefined,
      );
      expect(graphql).toHaveBeenCalledTimes(2);
    }
  });
  it('does not let an earlier unrelated partial response poison a later complete selector lookup', async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce({ data: { asset: page([]) }, errors: [{ message: 'partial' }] })
      .mockResolvedValueOnce({
        data: { asset: page([{ ...owner, pulseFields: page([makeField('f', 'B')]) }]) },
      });
    const traversal = new DataLineageTraversal(options, {
      graphql,
      isAllowed: async () => true,
      prepEnabled: true,
    });
    await traversal.resolve();
    expect((await traversal.lookupPulseField(ds, 'B'))?.id).toBe('f');
  });
  it('refuses denied or invalid owner identities before linking', async () => {
    const graphql = vi.fn().mockResolvedValue({
      data: { asset: page([{ ...owner, pulseFields: page([makeField('f', 'B')]) }]) },
    });
    const traversal = new DataLineageTraversal(options, {
      graphql,
      isAllowed: async () => false,
      prepEnabled: true,
    });
    expect(await traversal.lookupPulseField(ds, 'B')).toBeUndefined();
    expect(await traversal.lookupPulseField('../foreign', 'B')).toBeUndefined();
    expect(graphql).toHaveBeenCalledOnce();
  });
});
