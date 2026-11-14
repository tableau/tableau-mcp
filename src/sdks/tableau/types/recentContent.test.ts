import { recentContentResponseSchema, recentContentSchema } from './recentContent.js';

const view = {
  id: '8a922e79-3041-4916-942e-1a18162ef8a9',
  name: 'Overview',
  contentUrl: 'Superstore/sheets/Overview',
  createdAt: '2019-01-28T20:33:35Z',
  updatedAt: '2019-01-28T20:44:05Z',
  viewUrlName: 'Overview',
  workbook: { id: '5589cf2b-8601-43f9-9151-0f6c2db760cc' },
  owner: { id: 'owner-1' },
  project: { id: 'project-1' },
  tags: {},
};
const workbook = {
  id: '5589cf2b-8601-43f9-9151-0f6c2db760cc',
  name: 'Superstore',
  contentUrl: 'Superstore',
  createdAt: '2019-02-13T20:52:37Z',
  updatedAt: '2019-02-13T20:52:38Z',
  project: { id: 'project-1' },
  owner: { id: 'owner-1', name: 'analyst' },
  tags: {},
  showTabs: 'false',
  size: '7',
  encryptExtracts: 'false',
  defaultViewId: 'view-1',
};

describe('recent-content response fixture contract', () => {
  it('parses documented mixed metadata with ID-only references in backend order', () => {
    const result = recentContentResponseSchema.parse({
      recents: {
        recent: [
          { view },
          { workbook },
          { view: { ...view, id: '957f9629-1947-4a70-b52d-dc1b3ff997f3' } },
        ],
      },
    });
    expect(result.recents.recent).toEqual([
      { view },
      { workbook: { ...workbook, showTabs: false, size: 7, encryptExtracts: false } },
      { view: { ...view, id: '957f9629-1947-4a70-b52d-dc1b3ff997f3' } },
    ]);
  });

  it.each([{ recents: {} }, { recents: { recent: [] } }])('accepts empty recents %j', (data) => {
    expect(recentContentResponseSchema.parse(data).recents.recent ?? []).toEqual([]);
  });

  it('allows absent uncommon metadata fields', () => {
    expect(
      recentContentSchema.parse({
        workbook: {
          id: '5589cf2b-8601-43f9-9151-0f6c2db760cc',
          name: 'Workbook',
          contentUrl: 'Workbook',
        },
      }),
    ).toEqual({
      workbook: {
        id: '5589cf2b-8601-43f9-9151-0f6c2db760cc',
        name: 'Workbook',
        contentUrl: 'Workbook',
      },
    });
  });

  it('preserves content timestamps without inventing an access timestamp', () => {
    expect(recentContentSchema.parse({ view })).toMatchObject({
      view: { createdAt: view.createdAt, updatedAt: view.updatedAt },
    });
    expect(recentContentSchema.parse({ view })).not.toHaveProperty('lastViewedAt');
  });

  it('strips unknown metadata fields instead of exposing unmodeled data', () => {
    const result = recentContentSchema.parse({ view: { ...view, secret: 'unmodeled-value' } });
    expect(result).toEqual({ view });
  });

  it.each([
    {},
    { view, workbook },
    { flow: { id: 'flow-1' } },
    { view: { ...view, id: '' } },
    { workbook: { ...workbook, project: {} } },
    { workbook: { ...workbook, showTabs: 'invalid' } },
    { workbook: { ...workbook, size: null } },
  ])('rejects malformed or ambiguous recent row %j', (recent) => {
    expect(recentContentSchema.safeParse(recent).success).toBe(false);
  });

  it.each([{}, { recents: null }, { recents: { recent: { view } } }])(
    'rejects malformed recent response %j',
    (response) => {
      expect(recentContentResponseSchema.safeParse(response).success).toBe(false);
    },
  );

  it('rejects the entire response when one row is malformed', () => {
    expect(
      recentContentResponseSchema.safeParse({ recents: { recent: [{ view }, {}] } }).success,
    ).toBe(false);
  });
});
