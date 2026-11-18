import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { z } from 'zod';

import { WebMcpServer } from '../../server.web.js';
import { Provider } from '../../utils/provider.js';
import { webToolNames } from './toolName.js';
import { webToolFactories } from './tools.js';

vi.mock('../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: vi.fn().mockResolvedValue(true) })),
}));

const docsRoot = join(__dirname, '../../../docs/docs/web-tools');

function readToolPages(directory: string): Array<{ name: string; text: string }> {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return readToolPages(path);
    return entry.name.endsWith('.md') && entry.name !== 'overview.md'
      ? [{ name: basename(entry.name, '.md'), text: readFileSync(path, 'utf8') }]
      : [];
  });
}

describe('web tool documentation', () => {
  it('has exactly one reference page per registered tool, with current roles and conditions', async () => {
    const pages = readToolPages(docsRoot);
    const server = new WebMcpServer();
    // Construct every factory, including disabled/app-only tools, without invoking callbacks or
    // evaluating disabled providers. Version-dependent factories receive a supported version.
    const tools = await Promise.all(
      webToolFactories.map((factory) => factory(server, { value: '2026.3.0', build: '' })),
    );
    const matrix = readFileSync(join(docsRoot, 'overview.md'), 'utf8');

    expect(pages.map((page) => page.name).sort()).toEqual([...webToolNames].sort());
    expect(tools.map((tool) => tool.name).sort()).toEqual([...webToolNames].sort());

    for (const tool of tools) {
      const page = pages.find((page) => page.name === tool.name)?.text ?? '';
      const access = page.split('## Access requirements\n')[1]?.split('\n## ')[0] ?? '';
      expect(access, tool.name).toContain(
        `**Declared registration minimum:** \`${tool.minRequiredRole}\``,
      );
      expect(access.match(/`Requires\w+`/g) ?? [], tool.name).toEqual(
        tool.registrationConditions.map((condition) => `\`${condition}\``),
      );
      const row = matrix.split('\n').find((line) => line.startsWith(`| [\`${tool.name}\`]`));
      expect(row, tool.name).toBeDefined();
      expect(row, tool.name).toContain(`| \`${tool.minRequiredRole}\` |`);
      expect(row?.match(/`Requires\w+`/g) ?? [], tool.name).toEqual(
        tool.registrationConditions.map((condition) => `\`${condition}\``),
      );
      if (tool.meta?.ui?.visibility?.includes('app')) {
        expect(page, tool.name).toContain('app-only');
      }
      const schema = await Provider.from(tool.paramsSchema);
      const shape = schema instanceof z.ZodObject ? schema.shape : schema;
      for (const argument of Object.keys(shape ?? {})) {
        expect
          .soft(page, `${tool.name}: missing argument ${argument}`)
          .toContain(`\`${argument}\``);
      }
    }
  });
});
