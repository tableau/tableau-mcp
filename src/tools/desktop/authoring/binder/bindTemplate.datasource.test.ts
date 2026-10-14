import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import type { BindingProposal } from '../../../../desktop/binder/binder.js';
import * as binderModule from '../../../../desktop/binder/binder.js';
import { normalizeAskForMatch } from '../../../../desktop/binder/route-spec.js';
import { summarizeSchema } from '../../../../desktop/binder/schema-summary.js';
import * as discovery from '../../../../desktop/externalApi/discovery.js';
import { sessionRouteState } from '../../../../desktop/route/route-state.js';
import { buildInjectedWorkbookXml } from '../../../../desktop/templates/injectTemplateCore.js';
import * as getWorkbookXmlModule from '../../../../desktop/wrappers/getWorkbookXml.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import * as calcModule from '../datasource/authorCalcCore.js';
import { getBindTemplateTool } from './bindTemplate.js';

vi.mock('../../../../desktop/externalApi/discovery.js');
vi.mock('../../../../desktop/wrappers/getWorkbookXml.js');
vi.mock('../../../../desktop/binder/binder.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../desktop/binder/binder.js')>();
  return { ...actual, bindTemplate: vi.fn(actual.bindTemplate) };
});
vi.mock('../../../../desktop/templates/runtimeTemplateCatalog.js', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../../../desktop/templates/runtimeTemplateCatalog.js')
    >();
  return {
    ...actual,
    loadRuntimeTemplateCatalogSnapshots: (
      options: Parameters<typeof actual.loadRuntimeTemplateCatalogSnapshots>[0],
    ) => actual.loadRuntimeTemplateCatalogSnapshots({ ...options, includeExternal: false }),
  };
});
vi.mock('../datasource/authorCalcCore.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../datasource/authorCalcCore.js')>();
  return {
    ...actual,
    prepareCalculationsInWorkbook: vi.fn(actual.prepareCalculationsInWorkbook),
    authorCalculationsInWorkbook: vi.fn(
      async (args: Parameters<typeof actual.authorCalculationsInWorkbook>[0]) =>
        actual.prepareCalculationsInWorkbook(args),
    ),
  };
});
vi.mock('../../../../desktop/templates/injectTemplateCore.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../desktop/templates/injectTemplateCore.js')>();
  return {
    ...actual,
    buildInjectedWorkbookXml: vi.fn(() => {
      throw new Error('fixture stops before apply');
    }),
  };
});

const SOURCE = 'federated.orders';
const ASK = 'Create a bar chart of my data using Sample - Superstore';
const PROPOSAL: BindingProposal & { confidence: number } = {
  template: 'ranking-ordered-bar',
  title: 'Sales by Region',
  confidence: 0.95,
  bindings: [
    { slot_id: 'field_base_1', field: 'Region' },
    { slot_id: 'field_base_2', field: 'Sales' },
  ],
};
const XML = `<?xml version='1.0'?>
<workbook><datasources>
  <datasource name='federated.commission' caption='Sales Commission.csv'>
    <column name='[commission_region]' caption='Region' role='dimension' type='nominal' datatype='string' />
    <column name='[Sales]' role='measure' type='quantitative' datatype='real' />
    <connection><metadata-records>
      <metadata-record class='column'><local-name>[commission_region]</local-name><parent-name>[Sales Commission.csv]</parent-name><local-type>string</local-type></metadata-record>
      <metadata-record class='column'><local-name>[Sales]</local-name><parent-name>[Sales Commission.csv]</parent-name><local-type>real</local-type></metadata-record>
    </metadata-records></connection>
  </datasource>
  <datasource name='federated.orders' caption='Sample - Superstore'>
    <column name='[Category]' role='dimension' type='nominal' datatype='string' />
    <column name='[Profit]' role='measure' type='quantitative' datatype='real' />
    <connection><metadata-records>
      <metadata-record class='column'><local-name>[Region]</local-name><parent-name>[Orders]</parent-name><local-type>string</local-type><remote-name>Region</remote-name></metadata-record>
      <metadata-record class='column'><local-name>[Sales]</local-name><parent-name>[Orders]</parent-name><local-type>real</local-type><remote-name>Sales</remote-name></metadata-record>
    </metadata-records></connection>
  </datasource>
  <datasource name='federated.people' caption='People'>
    <column name='[Person]' role='dimension' type='nominal' datatype='string' />
  </datasource>
</datasources><worksheets /></workbook>`;

async function call(
  args: {
    datasource?: string;
    proposal?: typeof PROPOSAL;
    auto_apply?: boolean;
    skip_validation?: boolean;
    calcs?: Array<{ caption: string; formula: string }>;
  },
  allowSkipValidation = false,
): Promise<CallToolResult> {
  const callback = await Provider.from(getBindTemplateTool(new DesktopMcpServer()).callback);
  const extra = getMockRequestHandlerExtra();
  return callback(
    {
      session: '1',
      ask: ASK,
      minConfidence: undefined,
      target_worksheet: undefined,
      datasource: undefined,
      proposal: undefined,
      skip_validation: undefined,
      calcs: undefined,
      auto_apply: args.proposal !== undefined,
      ...args,
    },
    {
      ...extra,
      config: { ...extra.config, allowSkipValidation },
      getExecutor: vi.fn().mockResolvedValue({}),
    },
  );
}

function body(result: Awaited<ReturnType<typeof call>>): Record<string, any> {
  if (result.content[0]?.type !== 'text') throw new Error('expected text result');
  return JSON.parse(result.content[0].text);
}

beforeEach(() => {
  sessionRouteState.clear();
  vi.clearAllMocks();
  vi.mocked(discovery.discoverInstances).mockReturnValue([]);
  vi.mocked(getWorkbookXmlModule.getWorkbookXml).mockResolvedValue(Ok(XML));
});

describe('bind-template datasource scope with the real binder', () => {
  it.each([SOURCE, 'Sample - Superstore'])(
    'narrows Call 1 and binds friendly names for %s',
    async (datasource) => {
      const first = body(await call({ datasource }));
      expect(first.status).toBe('propose');
      expect(first.call_2_contract.arguments.datasource).toBe(SOURCE);
      expect(
        first.llm_input.fields.filter((field: { name: string }) => field.name === 'Sales'),
      ).toHaveLength(1);
      const second = body(await call({ datasource, proposal: PROPOSAL }));
      expect(second.status, JSON.stringify(second)).toBe('bound');
      expect(second.args.template_parameters.DATASOURCE).toBe(SOURCE);
      expect(second.args.field_mapping).toMatchObject({
        '{{field_base_1}}': `[${SOURCE}].[none:Region:nk]`,
        '{{field_base_2}}': `[${SOURCE}].[sum:Sales:qk]`,
      });
    },
  );

  it('inherits scope on an omitted Call-2 datasource and allows an equivalent caption', async () => {
    await call({ datasource: SOURCE });
    expect(body(await call({ proposal: PROPOSAL })).args.template_parameters.DATASOURCE).toBe(
      SOURCE,
    );
    sessionRouteState.clear();
    await call({ datasource: SOURCE });
    expect(body(await call({ datasource: 'Sample - Superstore', proposal: PROPOSAL })).status).toBe(
      'bound',
    );
  });

  it.each(['missing', 'Duplicate'])(
    'rejects an absent or ambiguous datasource %s before binding or mutation',
    async (datasource) => {
      vi.mocked(getWorkbookXmlModule.getWorkbookXml).mockResolvedValue(
        Ok(
          XML.replace("caption='People'", "caption='Duplicate'").replace(
            "caption='Sales Commission.csv'",
            "caption='Duplicate'",
          ),
        ),
      );
      const result = await call({
        datasource,
        proposal: PROPOSAL,
        auto_apply: true,
        calcs: [{ caption: 'Double Sales', formula: '[Sales] * 2' }],
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]).toMatchObject({
        text: expect.stringContaining('not found or ambiguous'),
      });
      expect(binderModule.bindTemplate).not.toHaveBeenCalled();
      expect(calcModule.authorCalculationsInWorkbook).not.toHaveBeenCalled();
      expect(calcModule.prepareCalculationsInWorkbook).not.toHaveBeenCalled();
      expect(buildInjectedWorkbookXml).not.toHaveBeenCalled();
    },
  );

  it.each(['federated.commission', 'missing', 'Duplicate'])(
    'rejects Call-2 scope %s without consuming its valid correction',
    async (datasource) => {
      vi.mocked(getWorkbookXmlModule.getWorkbookXml).mockResolvedValue(
        Ok(
          XML.replace("caption='People'", "caption='Duplicate'").replace(
            "caption='Sales Commission.csv'",
            "caption='Duplicate'",
          ),
        ),
      );
      await call({ datasource: SOURCE });
      vi.clearAllMocks();
      const result = await call({
        datasource,
        proposal: PROPOSAL,
        auto_apply: true,
        calcs: [{ caption: 'Double Sales', formula: '[Sales] * 2' }],
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]).toMatchObject({
        text: expect.stringContaining(
          datasource === 'federated.commission'
            ? 'must match the retained'
            : 'not found or ambiguous',
        ),
      });
      expect(binderModule.bindTemplate).not.toHaveBeenCalled();
      expect(calcModule.authorCalculationsInWorkbook).not.toHaveBeenCalled();
      expect(buildInjectedWorkbookXml).not.toHaveBeenCalled();
      expect(
        sessionRouteState.getBindRecovery('1', normalizeAskForMatch(ASK))?.proposalContext
          ?.arguments.datasource,
      ).toBe(SOURCE);
      expect(body(await call({ proposal: PROPOSAL })).status).toBe('bound');
    },
  );

  it('preserves scoped identity through the binding-only contract correction', async () => {
    await call({ datasource: 'Sample - Superstore' });
    const rejected = body(
      await call({
        proposal: {
          ...PROPOSAL,
          bindings: [
            { slot_id: 'field_base_1', field: `[${SOURCE}].[none:Region:nk]` },
            { slot_id: 'field_base_2', field: `[${SOURCE}].[sum:Sales:qk]` },
          ],
        },
      }),
    );
    expect(rejected.reason).toBe('proposal_contract_mismatch');
    expect(rejected.call_2_contract.arguments.datasource).toBe(SOURCE);
    expect(body(await call({ proposal: PROPOSAL })).args.template_parameters.DATASOURCE).toBe(
      SOURCE,
    );
  });

  it('admits one scoped Call 2 when workbook reads overlap', async () => {
    await call({ datasource: SOURCE });
    let releaseRead!: (result: ReturnType<typeof Ok<string>>) => void;
    const pendingRead = new Promise<ReturnType<typeof Ok<string>>>((resolve) => {
      releaseRead = resolve;
    });
    vi.mocked(getWorkbookXmlModule.getWorkbookXml).mockReturnValue(pendingRead);
    const args = {
      proposal: PROPOSAL,
      calcs: [{ caption: 'Double Sales', formula: '[Sales] * 2' }],
    };
    const first = call(args);
    const second = call(args);
    await vi.waitFor(() => expect(getWorkbookXmlModule.getWorkbookXml).toHaveBeenCalledTimes(3));
    releaseRead(Ok(XML));
    const results = (await Promise.all([first, second])).map(body);
    expect(results.map((result) => result.status).sort()).toEqual(['blocked', 'bound']);
    expect(
      vi.mocked(binderModule.bindTemplate).mock.calls.filter(([args]) => args.proposal),
    ).toHaveLength(1);
    expect(calcModule.authorCalculationsInWorkbook).toHaveBeenCalledTimes(1);
    expect(buildInjectedWorkbookXml).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    'passes inherited scope to inline calcs with atomic apply %s',
    async (atomic) => {
      await call({ datasource: SOURCE });
      const result = body(
        await call(
          {
            proposal: PROPOSAL,
            ...(atomic ? { auto_apply: true, skip_validation: true } : {}),
            calcs: [{ caption: 'Double Sales', formula: '[Sales] * 2' }],
          },
          atomic,
        ),
      );
      expect(result.status).toBe('bound');
      const calcCalls = atomic
        ? vi.mocked(calcModule.prepareCalculationsInWorkbook).mock.calls
        : vi.mocked(calcModule.authorCalculationsInWorkbook).mock.calls;
      expect(calcCalls).toHaveLength(1);
      expect(calcCalls[0][0].datasource).toBe(SOURCE);
      const boundCall = vi
        .mocked(binderModule.bindTemplate)
        .mock.calls.find(([args]) => args.proposal !== undefined);
      expect(boundCall?.[0].datasource).toBe(SOURCE);
      const summary = summarizeSchema(boundCall![0].workbookXml, SOURCE);
      expect(summary.fields.map((field) => field.name)).toContain('Double Sales');
      expect(
        summarizeSchema(boundCall![0].workbookXml, 'federated.commission').fields.map(
          (field) => field.name,
        ),
      ).not.toContain('Double Sales');
      expect(result.args.template_parameters.DATASOURCE).toBe(SOURCE);
    },
  );

  it('preserves unscoped duplicate-field ambiguity', async () => {
    const first = body(await call({}));
    expect(first.call_2_contract.arguments.datasource).toBeUndefined();
    expect(
      first.llm_input.fields.filter((field: { name: string }) => field.name === 'Sales'),
    ).toHaveLength(2);
    sessionRouteState.clear();
    const result = body(await call({ proposal: PROPOSAL }));
    expect(result.status).toBe('escalate');
    expect(result.blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'ambiguous-field' })]),
    );
  });
});
