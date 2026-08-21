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

const dashboardXml = (name: string, width = 1400, height = 1000): string =>
  `<dashboard name='${name}'><size maxheight='${height}' maxwidth='${width}' minheight='${height}' minwidth='${width}' sizing-mode='fixed'/><zones/><simple-id uuid='{${name}}'/></dashboard>`;

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
  it('exposes only an existing story and ordered dashboard points', () => {
    const tool = getComposeStoryTool(new DesktopMcpServer());
    expect(tool.name).toBe('compose-story');
    expect(Object.keys(tool.paramsSchema)).toEqual(['session', 'storyboard', 'points']);
    expect(tool.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
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
};

async function callTool(
  args: Args,
  options: { secondSize?: { width: number; height: number } } = {},
): Promise<{
  result: CallToolResult;
  applyStoryboardDocument: ReturnType<typeof vi.fn>;
}> {
  const dashboards = [
    { id: 'dashboard-1', name: 'Sales Overview' },
    { id: 'dashboard-2', name: 'Regional Performance' },
  ];
  let storyboardDocument = STORY_XML;
  const applyStoryboardDocument = vi.fn(async (_id: string, xml: string) => {
    storyboardDocument = xml.replaceAll('/>', ' />');
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
      return new Ok({ xml: dashboardXml(dashboard.name, size.width, size.height) });
    }),
    applyStoryboardDocument,
  };
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue(executor),
  };
  const callback = await Provider.from(getComposeStoryTool(new DesktopMcpServer()).callback);
  const result = await callback(
    { session: '12345', storyboard: 'Executive Story', points: args.points },
    extra,
  );
  return { result, applyStoryboardDocument };
}
