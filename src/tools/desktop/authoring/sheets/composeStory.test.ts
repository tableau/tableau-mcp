import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { composeStoryDocument, getComposeStoryTool } from './composeStory.js';

const STORY_XML = `<dashboard name='Executive Story' type='storyboard'>
  <size maxheight='964' maxwidth='1016' minheight='964' minwidth='1016' />
  <zones><zone type-v2='flipboard'><flipboard active-id='1' nav-type='caption' show-nav-arrows='true'>
    <story-points><story-point captured-sheet='' id='1' /></story-points>
  </flipboard></zone></zones>
  <simple-id uuid='{story-1}' />
</dashboard>`;

const POPULATED_STORY_XML = STORY_XML.replace(
  "<story-point captured-sheet='' id='1' />",
  "<story-point captured-sheet='Sales Overview' caption='Existing point' id='1' />",
);

const AUTOMATIC_MATCHING_STORY_XML = `<dashboard name='Executive Story' type='storyboard'>
  <size sizing-mode='automatic' />
  <zones><zone type-v2='flipboard'><flipboard active-id='1' nav-type='caption' show-nav-arrows='true'>
    <story-points><story-point captured-sheet='Sales Overview' caption='Overview' id='1' /></story-points>
  </flipboard></zone></zones>
  <simple-id uuid='{story-1}' />
</dashboard>`;

const dashboardXml = (
  name: string,
  width = 1400,
  height = 1000,
  sizingMode: string | undefined = 'fixed',
): string =>
  `<dashboard name='${name}'><size maxheight='${height}' maxwidth='${width}' minheight='${height}' minwidth='${width}'${sizingMode ? ` sizing-mode='${sizingMode}'` : ''}/><zones/><simple-id uuid='{${name}}'/></dashboard>`;

describe('composeStoryDocument', () => {
  it('uses the Tableau-authored flipboard shape and matches the common dashboard size', () => {
    const result = composeStoryDocument(STORY_XML, {
      width: 1400,
      height: 1000,
      points: [
        { dashboard: 'Sales Overview', caption: 'Overview' },
        { dashboard: 'Regional Performance', caption: 'Regions' },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml).toContain("maxheight='1000'");
    expect(result.xml).toContain("maxwidth='1400'");
    expect(result.xml).toContain("captured-sheet='Sales Overview' caption='Overview' id='1'");
    expect(result.xml).toContain("captured-sheet='Regional Performance' caption='Regions' id='2'");
    expect(result.xml.match(/<story-point\b/g)).toHaveLength(2);
    expect(result.xml).toContain("active-id='1'");
  });

  it('escapes dashboard names and captions as XML attributes', () => {
    const result = composeStoryDocument(STORY_XML, {
      width: 1400,
      height: 1000,
      points: [{ dashboard: "Sales & O'Brien", caption: 'Sales < Profit' }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml).toContain("captured-sheet='Sales &amp; O&apos;Brien'");
    expect(result.xml).toContain("caption='Sales &lt; Profit'");
  });

  it('preserves dollar replacement tokens in story point attributes', () => {
    const result = composeStoryDocument(STORY_XML, {
      width: 1400,
      height: 1000,
      points: [{ dashboard: 'Sales $$ Overview', caption: "Revenue $& O'Brien" }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml).toContain("captured-sheet='Sales $$ Overview'");
    expect(result.xml).toContain("caption='Revenue $&amp; O&apos;Brien'");
  });

  it('fails closed when the story has no Tableau-authored story-points container', () => {
    const result = composeStoryDocument(
      STORY_XML.replace(
        "<story-points><story-point captured-sheet='' id='1' /></story-points>",
        '',
      ),
      { width: 1400, height: 1000, points: [{ dashboard: 'Sales Overview' }] },
    );

    expect(result).toMatchObject({ ok: false });
  });
});

describe('compose-story tool', () => {
  it('exposes bounded replacement and marks explicit replacement destructive', () => {
    const tool = getComposeStoryTool(new DesktopMcpServer());
    expect(tool.name).toBe('compose-story');
    expect(Object.keys(tool.paramsSchema)).toEqual([
      'session',
      'storyboard',
      'points',
      'replaceExisting',
    ]);
    const replaceExisting = Object.entries(tool.paramsSchema).find(
      ([name]) => name === 'replaceExisting',
    )?.[1];
    expect(replaceExisting?.safeParse(undefined).success).toBe(true);
    expect(tool.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
  });

  it('preflights matching fixed dashboard sizes, applies once, and verifies readback', async () => {
    const { result, applyStoryboardDocument } = await callTool({
      points: [
        { dashboard: 'Sales Overview', caption: 'Overview' },
        { dashboard: 'Regional Performance', caption: 'Regions' },
      ],
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      storyboard: 'Executive Story',
      size: { width: 1400, height: 1000 },
      points: [
        { dashboard: 'Sales Overview', caption: 'Overview' },
        { dashboard: 'Regional Performance', caption: 'Regions' },
      ],
      verified: true,
    });
    expect(applyStoryboardDocument).toHaveBeenCalledTimes(1);
  });

  it('refuses a populated story by default before applying', async () => {
    const { result, applyStoryboardDocument } = await callTool(
      { points: [{ dashboard: 'Regional Performance', caption: 'Regions' }] },
      { storyboardXml: POPULATED_STORY_XML },
    );

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('replaceExisting');
    expect(applyStoryboardDocument).not.toHaveBeenCalled();
  });

  it('replaces a populated story only when replaceExisting is true', async () => {
    const { result, applyStoryboardDocument } = await callTool(
      {
        points: [{ dashboard: 'Regional Performance', caption: 'Regions' }],
        replaceExisting: true,
      },
      { storyboardXml: POPULATED_STORY_XML },
    );

    expect(result.isError).toBe(false);
    expect(applyStoryboardDocument).toHaveBeenCalledTimes(1);
  });

  it('accepts an empty Tableau placeholder without replacement permission', async () => {
    const { result, applyStoryboardDocument } = await callTool({
      points: [{ dashboard: 'Sales Overview', caption: 'Overview' }],
    });

    expect(result.isError).toBe(false);
    expect(applyStoryboardDocument).toHaveBeenCalledTimes(1);
  });

  it('accepts an exact populated story idempotently without applying', async () => {
    const exact = POPULATED_STORY_XML.replace("caption='Existing point'", "caption='Overview'")
      .replace("maxheight='964'", "maxheight='1000'")
      .replace("maxwidth='1016'", "maxwidth='1400'")
      .replace("minheight='964'", "minheight='1000'")
      .replace("minwidth='1016'", "minwidth='1400'");
    const { result, applyStoryboardDocument } = await callTool(
      { points: [{ dashboard: 'Sales Overview', caption: 'Overview' }] },
      { storyboardXml: exact },
    );

    expect(result.isError).toBe(false);
    expect(applyStoryboardDocument).not.toHaveBeenCalled();
  });

  it('recomposes a matching automatic story as fixed before reporting verified', async () => {
    const { result, applyStoryboardDocument } = await callTool(
      {
        points: [{ dashboard: 'Sales Overview', caption: 'Overview' }],
        replaceExisting: true,
      },
      { storyboardXml: AUTOMATIC_MATCHING_STORY_XML },
    );

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      size: { width: 1400, height: 1000 },
      verified: true,
    });
    expect(applyStoryboardDocument).toHaveBeenCalledTimes(1);
    expect(applyStoryboardDocument.mock.calls[0]?.[1]).toContain("sizing-mode='fixed'");
  });

  it('does not report verified when story readback remains automatic', async () => {
    vi.useFakeTimers();
    try {
      const pending = callTool(
        {
          points: [{ dashboard: 'Sales Overview', caption: 'Overview' }],
          replaceExisting: true,
        },
        {
          storyboardXml: AUTOMATIC_MATCHING_STORY_XML,
          persistAutomaticSizingMode: true,
        },
      );
      await vi.runAllTimersAsync();
      const { result, applyStoryboardDocument } = await pending;

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('points or size did not survive readback');
      expect(applyStoryboardDocument).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects an explicitly non-fixed dashboard size', async () => {
    const { result, applyStoryboardDocument } = await callTool(
      { points: [{ dashboard: 'Sales Overview' }] },
      { sizingMode: 'automatic' },
    );

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('fixed size');
    expect(applyStoryboardDocument).not.toHaveBeenCalled();
  });

  it('accepts a legacy dashboard with equal bounds and no sizing mode', async () => {
    const { result } = await callTool(
      { points: [{ dashboard: 'Sales Overview' }] },
      { omitSizingMode: true },
    );

    expect(result.isError).toBe(false);
  });

  it('rejects inconsistent dashboard sizes before applying', async () => {
    const { result, applyStoryboardDocument } = await callTool(
      {
        points: [{ dashboard: 'Sales Overview' }, { dashboard: 'Regional Performance' }],
      },
      { secondSize: { width: 1200, height: 800 } },
    );

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('same fixed size');
    expect(applyStoryboardDocument).not.toHaveBeenCalled();
  });

  it('rejects duplicate dashboard targets before applying', async () => {
    const { result, applyStoryboardDocument } = await callTool({
      points: [{ dashboard: 'Sales Overview' }, { dashboard: 'Sales Overview' }],
    });

    expect(result.isError).toBe(true);
    expect(applyStoryboardDocument).not.toHaveBeenCalled();
  });
});

type Args = {
  points: Array<{ dashboard: string; caption?: string }>;
  replaceExisting?: boolean;
};

async function callTool(
  args: Args,
  options: {
    secondSize?: { width: number; height: number };
    storyboardXml?: string;
    sizingMode?: string;
    omitSizingMode?: boolean;
    persistAutomaticSizingMode?: boolean;
  } = {},
): Promise<{
  result: CallToolResult;
  applyStoryboardDocument: ReturnType<typeof vi.fn>;
}> {
  const dashboards = [
    { id: 'dashboard-1', name: 'Sales Overview' },
    { id: 'dashboard-2', name: 'Regional Performance' },
  ];
  let storyboardDocument = options.storyboardXml ?? STORY_XML;
  const applyStoryboardDocument = vi.fn(async (_id: string, xml: string) => {
    storyboardDocument = xml.replaceAll('/>', ' />');
    if (options.persistAutomaticSizingMode) {
      storyboardDocument = storyboardDocument.replace(
        "sizing-mode='fixed'",
        "sizing-mode='automatic'",
      );
    }
    return new Ok({ command_id: 'apply-story', status: 'completed', result: null });
  });
  const executor = {
    instanceId: 'desktop-instance',
    listStoryboards: vi
      .fn()
      .mockResolvedValue(new Ok({ storyboards: [{ id: 'story-1', name: 'Executive Story' }] })),
    getStoryboardDocument: vi.fn(async () => new Ok({ xml: storyboardDocument })),
    listDashboards: vi.fn().mockResolvedValue(new Ok({ dashboards })),
    getDashboardDocument: vi.fn(async (id: string) => {
      const dashboard = dashboards.find((candidate) => candidate.id === id)!;
      const size =
        id === 'dashboard-2' && options.secondSize
          ? options.secondSize
          : { width: 1400, height: 1000 };
      return new Ok({
        xml: dashboardXml(
          dashboard.name,
          size.width,
          size.height,
          options.omitSizingMode ? undefined : (options.sizingMode ?? 'fixed'),
        ),
      });
    }),
    applyStoryboardDocument,
  };
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue(executor),
  };
  const callback = await Provider.from(getComposeStoryTool(new DesktopMcpServer()).callback);
  const result = await callback(
    {
      session: '12345',
      storyboard: 'Executive Story',
      points: args.points,
      replaceExisting: args.replaceExisting,
    },
    extra,
  );
  return { result, applyStoryboardDocument };
}
