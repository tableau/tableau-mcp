import { WorkbookExtension } from '../../../../desktop/externalApi/types.js';
import { McpToolError } from '../../../../errors/mcpToolError.js';
import { selectExportExtension } from './exportDataApp.js';

const extension = (
  instanceId: string,
  sheetId: string,
  packagePath: string | null = `/pkg/${instanceId}`,
): WorkbookExtension => ({
  instanceId,
  sheet: { id: sheetId, kind: 'dashboard' },
  extension: { id: `com.example.${instanceId}`, version: '1.0.0', url: `tableau://${instanceId}` },
  packagePath,
});

describe('selectExportExtension', () => {
  it('selects by instanceId when provided', () => {
    const selected = selectExportExtension(
      [extension('a', 'dash-1'), extension('b', 'dash-1')],
      'dash-1',
      'b',
    );
    expect(selected).toMatchObject({ instanceId: 'b', packagePath: '/pkg/b' });
  });

  it('selects by sheet when exactly one match', () => {
    const selected = selectExportExtension([extension('a', 'dash-1')], 'dash-1');
    expect(selected).toMatchObject({ instanceId: 'a' });
  });

  it('lists instanceIds when sheet matches more than one extension', () => {
    const selected = selectExportExtension(
      [extension('a', 'dash-1'), extension('b', 'dash-1')],
      'dash-1',
    );
    expect(selected).toBeInstanceOf(McpToolError);
    expect((selected as McpToolError).message).toContain('instanceId');
    expect((selected as McpToolError).message).toContain('a, b');
  });

  it('rejects an instanceId that belongs to a different sheet', () => {
    const selected = selectExportExtension(
      [extension('a', 'dash-1'), extension('b', 'dash-2')],
      'dash-1',
      'b',
    );
    expect(selected).toBeInstanceOf(McpToolError);
    expect((selected as McpToolError).message).toContain('dash-2');
    expect((selected as McpToolError).message).toContain('dash-1');
  });
});
