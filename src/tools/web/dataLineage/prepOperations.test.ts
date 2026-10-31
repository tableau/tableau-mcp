import { expressionReferences, extractPrepOperations } from './prepOperations.js';

describe('Prep JSON operation extraction', () => {
  it('reads nested calculations, filters, joins, aggregates, renames and type changes', () => {
    const nodes = {
      clean: {
        id: 'clean',
        nodeType: '.v1.Container',
        loomContainer: {
          nodes: {
            calc: {
              id: 'calc',
              nodeType: '.v1.AddColumn',
              columnName: 'Gross',
              expression: '[Sales] * 1.1',
            },
            filter: { nodeType: '.v1.FilterOperation', expression: '[Gross] > 0' },
            range: { nodeType: '.v1.RangeFilter', ranges: { 'Order Date': [] } },
            rename: { nodeType: '.v1.RenameColumn', columnName: 'Gross', rename: 'Revenue' },
            type: {
              nodeType: '.v1.ChangeColumnType',
              fields: { Revenue: { type: 'real', calc: 'FLOAT([Revenue])' } },
            },
            remove: { nodeType: '.v1.RemoveColumns', columnNames: ['Temp'] },
            remap: {
              nodeType: '.v1.Remap',
              columnName: 'State',
              values: { hiddenValue: 'never emitted' },
            },
          },
        },
      },
      join: {
        id: 'join',
        nodeType: '.v2018_2_3.SuperJoin',
        actionNode: {
          nodeType: '.v1.SimpleJoin',
          conditions: [{ leftExpression: '[Order ID]', rightExpression: '[ID]', comparator: '==' }],
        },
      },
      aggregate: {
        id: 'aggregate',
        nodeType: '.v2018_2_3.SuperAggregate',
        actionNode: {
          nodeType: '.v1.Aggregate',
          groupByFields: [{ columnName: 'Region' }],
          aggregateFields: [{ columnName: 'Sales', function: 'SUM', newColumnName: 'Total' }],
        },
      },
      input: {
        nodeType: '.v1.LoadCsv',
        actions: [{ nodeType: '.v1.RemoveColumn', columnName: 'Unused' }],
        connectionAttributes: { password: 'DO_NOT_RETURN' },
      },
    };
    const { operations, truncated } = extractPrepOperations(nodes, 50);
    expect(truncated).toBe(false);
    expect(operations.find((op) => op.operation === 'AddColumn')).toMatchObject({
      path: ['nodes', 'clean', 'loomContainer', 'nodes', 'calc'],
      expression: '[Sales] * 1.1',
      references: ['Sales'],
      outputs: ['Gross'],
      status: 'references-extracted',
    });
    expect(operations.find((op) => op.operation === 'SimpleJoin')).toMatchObject({
      parentStepId: 'join',
      references: ['Order ID', 'ID'],
      conditions: [{ comparator: '==' }],
    });
    expect(operations.find((op) => op.operation === 'Aggregate')).toMatchObject({
      references: ['Region', 'Sales'],
      outputs: ['Region', 'Total'],
    });
    expect(operations.find((op) => op.operation === 'RenameColumn')?.rename).toEqual({
      from: 'Gross',
      to: 'Revenue',
    });
    expect(operations.find((op) => op.operation === 'ChangeColumnType')?.references).toEqual([
      'Revenue',
    ]);
    expect(operations.find((op) => op.operation === 'RemoveColumn')?.removes).toEqual(['Unused']);
    expect(JSON.stringify(operations)).not.toMatch(
      /DO_NOT_RETURN|hiddenValue|never emitted|password/,
    );
  });

  it('does not mistake literal and comment text for field dependencies', () => {
    const result = expressionReferences(
      "[Sales] + \"[not a field]\" + 'it''s [literal]' /* [comment] */ + [Cost] // [comment]\n + [Sales]",
    );
    expect(result).toEqual({ names: ['Sales', 'Cost'], complete: true });
  });
  it('reads the native filterExpression key but leaves unknown node versions unresolved', () => {
    const { operations } = extractPrepOperations(
      {
        native: { nodeType: '.v1.FilterOperation', filterExpression: '[Sales] > 0' },
        future: { nodeType: '.v999.Filter', filterExpression: '[Sales] > 0' },
      },
      10,
    );
    expect(operations[0]).toMatchObject({ references: ['Sales'], status: 'references-extracted' });
    expect(operations[1]).toMatchObject({ references: [], status: 'unknown' });
  });

  it.each(['[unterminated', '"unterminated', '/* unterminated', '[bad[nested]'])(
    'reports unsupported/malformed expression syntax %s',
    (expression) => {
      expect(expressionReferences(expression).complete).toBe(false);
      const result = extractPrepOperations({ n: { nodeType: '.v1.AddColumn', expression } }, 10);
      expect(result.operations[0].status).toBe('unknown');
    },
  );

  it('leaves union, pivot, split and unfamiliar shapes unknown without inventing references', () => {
    const result = extractPrepOperations(
      {
        a: { nodeType: '.v1.SimpleUnion', fieldMappings: { Sales: 'Other' } },
        b: { nodeType: '.v1.Pivot' },
        c: { nodeType: '.v1.SplitColumn', expression: '[Sales]' },
      },
      10,
    );
    expect(
      result.operations.every((op) => op.status === 'unknown' && op.references.length === 0),
    ).toBe(true);
  });

  it('bounds nesting, operation count and expression size', () => {
    const expression = '[Sales] + ' + 'x'.repeat(8000);
    const result = extractPrepOperations(
      {
        a: { nodeType: '.v1.AddColumn', expression },
        b: { nodeType: '.v1.AddColumn', expression: '[Cost]' },
      },
      1,
    );
    expect(result.truncated).toBe(true);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].expression).toHaveLength(8000);
    expect(result.operations[0].status).toBe('unknown');
  });
});
