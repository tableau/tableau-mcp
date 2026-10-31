import { BoundedContext } from '../../../overridableConfig.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { lineageAccess } from './lineageAccess.js';

const mocks = vi.hoisted(() => ({
  datasource: vi.fn(),
  workbook: vi.fn(),
  flow: vi.fn(),
  view: vi.fn(),
}));
vi.mock('../resourceAccessChecker.js', () => ({
  resourceAccessChecker: {
    isDatasourceAllowed: mocks.datasource,
    isWorkbookAllowed: mocks.workbook,
    isFlowAllowed: mocks.flow,
    isViewAllowed: mocks.view,
  },
}));
const noBounds: BoundedContext = {
  projectIds: null,
  datasourceIds: null,
  workbookIds: null,
  viewIds: null,
  tags: null,
};
const base = { id: 'x', __typename: 'Column' };

describe('lineage asset boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.values(mocks).forEach((mock) => mock.mockResolvedValue({ allowed: true }));
  });
  it('excludes external columns whenever any bounded context is configured', async () => {
    const extra = getMockRequestHandlerExtra();
    expect(await lineageAccess(extra, noBounds)(base, 'column')).toBe(true);
    for (const key of Object.keys(noBounds))
      expect(
        await lineageAccess(extra, { ...noBounds, [key]: new Set(['allowed']) })(base, 'column'),
      ).toBe(false);
  });
  it('gates published field owners and verifies embedded ownership using its workbook', async () => {
    const extra = getMockRequestHandlerExtra(),
      access = lineageAccess(extra, { ...noBounds, projectIds: new Set(['p']) });
    mocks.datasource.mockResolvedValue({ allowed: false });
    expect(
      await access(
        {
          ...base,
          __typename: 'CalculatedField',
          datasource: { id: 'ds-meta', __typename: 'PublishedDatasource', luid: 'ds-luid' },
        },
        'field',
      ),
    ).toBe(false);
    expect(mocks.datasource).toHaveBeenCalledWith({ datasourceLuid: 'ds-luid', extra });
    expect(
      await access(
        {
          ...base,
          __typename: 'ColumnField',
          datasource: {
            id: 'unqueryable',
            __typename: 'EmbeddedDatasource',
            workbook: { luid: 'wb' },
          },
        },
        'field',
      ),
    ).toBe(true);
    expect(mocks.workbook).toHaveBeenCalledWith({ workbookId: 'wb', extra });
    expect(mocks.datasource).not.toHaveBeenCalledWith(
      expect.objectContaining({ datasourceLuid: 'unqueryable' }),
    );
  });
  it('fails closed for an embedded datasource under a datasource-ID ceiling', async () => {
    const access = lineageAccess(getMockRequestHandlerExtra(), {
      ...noBounds,
      datasourceIds: new Set(['allowed']),
    });
    expect(
      await access(
        { ...base, __typename: 'EmbeddedDatasource', workbook: { luid: 'allowed-wb' } },
        'datasource',
      ),
    ).toBe(false);
  });
  it('requires every output-field flow owner to satisfy the boundary', async () => {
    mocks.flow.mockImplementation(async ({ flowId }) => ({ allowed: flowId !== 'denied' }));
    const access = lineageAccess(getMockRequestHandlerExtra(), noBounds);
    expect(
      await access(
        {
          ...base,
          __typename: 'FlowColumnOutputField',
          flow: [{ luid: 'allowed' }, { luid: 'denied' }],
        },
        'flow-output-field',
      ),
    ).toBe(false);
  });
  it('checks both view and workbook restrictions and rejects missing ownership under bounds', async () => {
    const access = lineageAccess(getMockRequestHandlerExtra(), {
      ...noBounds,
      viewIds: new Set(['v']),
    });
    expect(
      await access(
        { ...base, __typename: 'Sheet', luid: 'other', workbook: { luid: 'w' } },
        'sheet',
      ),
    ).toBe(false);
    expect(await access({ ...base, __typename: 'Sheet', luid: 'v' }, 'sheet')).toBe(false);
    expect(
      await access({ ...base, __typename: 'Sheet', luid: 'v', workbook: { luid: 'w' } }, 'sheet'),
    ).toBe(true);
  });
});
