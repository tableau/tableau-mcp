import { WebMcpServer } from '../../server.web.js';
import { VIBE_CODE_DATA_APP_SKILL_URI } from './vibeCodeDataApp.js';
import { getVibeCodeDataAppSkillResource } from './vibeCodeDataAppResource.js';

describe('vibeCodeDataApp skill resource', () => {
  const resource = getVibeCodeDataAppSkillResource(new WebMcpServer());

  it('is exposed at the skill:// URI as markdown', () => {
    expect(resource.uri).toBe(VIBE_CODE_DATA_APP_SKILL_URI);
    expect(resource.mimeType).toBe('text/markdown');
    expect(resource.disabled({} as never)).toBe(false);
  });

  it('returns the skill content with the cardinal rules', async () => {
    const result = await resource.read();
    const text = (result.contents[0] as { text: string }).text;
    expect(text).toMatch(/hardcode data/i);
    expect(text).toContain('window.tableauData.query');
    expect(text).toContain('initializeAsync');
  });

  it('documents the multi-resource model', async () => {
    const result = await resource.read();
    const text = (result.contents[0] as { text: string }).text;
    expect(text).toContain('getViewData');
    expect(text).toContain('getWorkbookViews');
    expect(text).toContain('getMetrics');
  });
});
