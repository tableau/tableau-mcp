import { Result } from 'ts-results-es';

import {
  collectUnknownKeys,
  datasourceEnvelopeSchema,
  queryOptionsArgSchema,
  QueryRequestEnvelopeArgs,
  ResolvedQueryRequestArgs,
  resolveQueryRequestArgs,
} from './resolveQueryRequestArgs.js';

const luid = '71db762b-6201-466b-93da-57cc0aec8ed9';
const otherLuid = '2d7a3b9e-3f1c-4b8e-9a5d-6c1e2f3a4b5c';
const query = { fields: [{ fieldCaption: 'Category' }] };

function resolve(args: QueryRequestEnvelopeArgs): Result<ResolvedQueryRequestArgs, string> {
  return resolveQueryRequestArgs({ query, ...args });
}

function resolveOk(args: QueryRequestEnvelopeArgs): ResolvedQueryRequestArgs {
  const result = resolve(args);
  if (result.isErr()) throw new Error(`expected Ok, got Err: ${result.error}`);
  return result.value;
}

function resolveErr(args: QueryRequestEnvelopeArgs): string {
  const result = resolve(args);
  if (result.isOk()) throw new Error('expected Err, got Ok');
  return result.error;
}

describe('resolveQueryRequestArgs', () => {
  describe('datasource LUID', () => {
    it.each([
      { name: 'flat only', args: { datasourceLuid: luid } },
      { name: 'envelope only', args: { datasource: { datasourceLuid: luid } } },
      { name: 'both equal', args: { datasourceLuid: luid, datasource: { datasourceLuid: luid } } },
    ])('resolves from $name', ({ args }) => {
      expect(resolveOk(args).datasourceLuid).toBe(luid);
    });

    it('errors naming both values when they differ', () => {
      const error = resolveErr({ datasourceLuid: luid, datasource: { datasourceLuid: otherLuid } });
      expect(error).toContain(luid);
      expect(error).toContain(otherLuid);
    });

    it.each([{ args: {} }, { args: { datasource: {} } }])(
      'errors when neither is given: $args',
      ({ args }) => {
        expect(resolveErr(args)).toContain('A data source is required');
      },
    );
  });

  describe('workbookDatasourceId', () => {
    it.each([
      { name: 'with a LUID', datasource: { datasourceLuid: luid, workbookDatasourceId: 'ds1' } },
      { name: 'without a LUID', datasource: { workbookDatasourceId: 'ds1' } },
    ])('errors $name and points at datasourceLuid + workbookLuid', ({ datasource }) => {
      const error = resolveErr({ datasource });
      expect(error).toContain('datasource.workbookDatasourceId is not supported');
      expect(error).toContain('datasourceLuid');
      expect(error).toContain('workbookLuid');
    });
  });

  describe('datasource.connections', () => {
    it('warns and never returns the credentials', () => {
      const connections = [{ connectionUsername: 'u', connectionPassword: 'hunter2' }];
      const resolved = resolveOk({ datasource: { datasourceLuid: luid, connections } });

      expect(resolved.warnings).toEqual([
        expect.objectContaining({
          type: 'IGNORED_REQUEST_PROPERTY',
          severity: 'WARNING',
          affectedProperties: ['datasource.connections'],
        }),
      ]);
      expect(JSON.stringify(resolved)).not.toContain('hunter2');
    });
  });

  describe('limit and options.rowLimit', () => {
    it.each([
      { args: { limit: 5 }, expected: 5 },
      { args: { options: { rowLimit: 7 } }, expected: 7 },
      { args: { limit: 5, options: { rowLimit: 7 } }, expected: 5 },
      { args: { limit: 9, options: { rowLimit: 7 } }, expected: 7 },
      { args: {}, expected: undefined },
    ])('resolves $args to $expected', ({ args, expected }) => {
      expect(resolveOk({ datasourceLuid: luid, ...args }).limit).toBe(expected);
    });
  });

  describe('interpretFieldCaptionsAsFieldNames', () => {
    it.each([
      { args: { options: { interpretFieldCaptionsAsFieldNames: true } }, expected: true },
      {
        args: {
          interpretFieldCaptionsAsFieldNames: true,
          options: { interpretFieldCaptionsAsFieldNames: true },
        },
        expected: true,
      },
      {
        args: {
          interpretFieldCaptionsAsFieldNames: false,
          options: { interpretFieldCaptionsAsFieldNames: false },
        },
        expected: false,
      },
      { args: { interpretFieldCaptionsAsFieldNames: true }, expected: true },
      { args: {}, expected: undefined },
    ])('resolves $args to $expected', ({ args, expected }) => {
      expect(resolveOk({ datasourceLuid: luid, ...args }).interpretFieldCaptionsAsFieldNames).toBe(
        expected,
      );
    });

    it('errors when the two sources conflict', () => {
      const error = resolveErr({
        datasourceLuid: luid,
        interpretFieldCaptionsAsFieldNames: true,
        options: { interpretFieldCaptionsAsFieldNames: false },
      });
      expect(error).toContain('options.interpretFieldCaptionsAsFieldNames');
      expect(error).toContain('differ');
    });
  });

  describe('forwarded options', () => {
    it('returns only the forwarded options the caller set', () => {
      const resolved = resolveOk({
        datasourceLuid: luid,
        options: {
          disaggregate: true,
          bypassMetadataCache: false,
          withNewSession: true,
          rowLimit: 3,
          returnFormat: 'OBJECTS',
        },
      });
      expect(resolved.forwardedOptions).toEqual({
        disaggregate: true,
        bypassMetadataCache: false,
        withNewSession: true,
      });
    });

    it('returns an empty object when no options are given', () => {
      expect(resolveOk({ datasourceLuid: luid }).forwardedOptions).toEqual({});
    });
  });

  describe('overridden options', () => {
    // Warn whenever present (D2). Flip these if J3 lands on "warn only when different".
    it.each([
      { options: { returnFormat: 'OBJECTS' as const }, affected: ['options.returnFormat'] },
      { options: { returnFormat: 'ARRAYS' as const }, affected: ['options.returnFormat'] },
      { options: { debug: false }, affected: ['options.debug'] },
      { options: { returnServerSentEvents: true }, affected: ['options.returnServerSentEvents'] },
      {
        options: { returnFormat: 'ARRAYS' as const, debug: false, returnServerSentEvents: true },
        affected: ['options.returnFormat', 'options.debug', 'options.returnServerSentEvents'],
      },
    ])('warns once for $options', ({ options, affected }) => {
      const { warnings } = resolveOk({ datasourceLuid: luid, options });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({
        type: 'IGNORED_REQUEST_PROPERTY',
        affectedProperties: affected,
      });
    });

    it('does not warn when none are present', () => {
      expect(resolveOk({ datasourceLuid: luid, options: { rowLimit: 3 } }).warnings).toEqual([]);
    });
  });

  describe('read-metadata-only options', () => {
    it.each(['includeHiddenFields', 'includeGroupFormulas', 'includeRemoteDatabaseNames'])(
      'warns on %s: true and does not treat it as unknown',
      (key) => {
        const { warnings } = resolveOk({ datasourceLuid: luid, options: { [key]: true } });
        expect(warnings).toEqual([
          expect.objectContaining({ affectedProperties: [`options.${key}`] }),
        ]);
      },
    );

    it.each(['includeHiddenFields', 'includeGroupFormulas', 'includeRemoteDatabaseNames'])(
      'does not warn on %s: false',
      (key) => {
        expect(resolveOk({ datasourceLuid: luid, options: { [key]: false } }).warnings).toEqual([]);
      },
    );
  });

  describe('unknown keys', () => {
    it('returns one error listing unknown keys at every level as dotted paths', () => {
      const error = resolveErr({
        datasourceLuid: luid,
        baz: 1,
        datasource: { datasourceLuid: luid, bar: 2 },
        options: { foo: 3 },
      });
      expect(error).toBe(
        'Unrecognized arguments: `baz`, `datasource.bar`, `options.foo`. Remove them or check the spelling.',
      );
    });

    it('checks unknown keys before anything else', () => {
      // Conflicting LUIDs would also error; the unknown-key error wins.
      const error = resolveErr({
        datasourceLuid: luid,
        datasource: { datasourceLuid: otherLuid },
        options: { foo: 1 },
      });
      expect(error).toContain('Unrecognized arguments: `options.foo`');
    });
  });
});

describe('collectUnknownKeys', () => {
  it('treats top-level interpretFieldCaptionsAsFieldNames as known so the caption-tier guard sees it', () => {
    expect(
      collectUnknownKeys({
        datasourceLuid: luid,
        workbookLuid: luid,
        query,
        limit: 1,
        interpretFieldCaptionsAsFieldNames: true,
      }),
    ).toEqual([]);
  });

  it('ignores a non-object datasource or options', () => {
    expect(
      collectUnknownKeys({ datasource: 'x', options: [1] } as unknown as QueryRequestEnvelopeArgs),
    ).toEqual([]);
  });
});

describe('envelope schemas', () => {
  it('keep unknown keys so collectUnknownKeys can report them', () => {
    expect(datasourceEnvelopeSchema.parse({ datasourceLuid: luid, bar: 1 })).toEqual({
      datasourceLuid: luid,
      bar: 1,
    });
    expect(queryOptionsArgSchema.parse({ foo: 1 })).toEqual({ foo: 1 });
  });

  it('bound rowLimit like limit', () => {
    expect(queryOptionsArgSchema.safeParse({ rowLimit: 2147483646 }).success).toBe(true);
    expect(queryOptionsArgSchema.safeParse({ rowLimit: 2147483647 }).success).toBe(false);
    expect(queryOptionsArgSchema.safeParse({ rowLimit: 0 }).success).toBe(false);
  });

  it('rejects a non-LUID datasourceLuid', () => {
    expect(datasourceEnvelopeSchema.safeParse({ datasourceLuid: 'nope' }).success).toBe(false);
  });
});
