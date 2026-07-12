// TEMP measurement scratch — replicates the MCP SDK tools/list serialization used by the
// frontmatter census. Not committed; delete after use.
import { normalizeObjectSchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';

import { DESKTOP_INSTRUCTIONS, DesktopMcpServer } from '../src/server.desktop.js';
import { desktopToolFactories } from '../src/tools/desktop/tools.js';
import { Provider } from '../src/utils/provider.js';

const EMPTY_OBJECT_JSON_SCHEMA = { type: 'object', properties: {} };

async function main() {
  const server = new DesktopMcpServer();
  const tools = desktopToolFactories.map((f) => f(server));

  const rows: Array<{
    name: string;
    descChars: number;
    schemaChars: number;
    totalChars: number;
  }> = [];

  let total = 0;

  for (const tool of tools) {
    const name = tool.name;
    const title = await Provider.from(tool.title);
    const description = await Provider.from(tool.description);
    const paramsSchema = await Provider.from(tool.paramsSchema);
    const annotations = await Provider.from(tool.annotations);

    const obj = normalizeObjectSchema(paramsSchema as Parameters<typeof normalizeObjectSchema>[0]);
    const inputSchema = obj
      ? toJsonSchemaCompat(obj, {
          strictUnions: true,
          pipeStrategy: 'input',
        } as Parameters<typeof toJsonSchemaCompat>[1])
      : EMPTY_OBJECT_JSON_SCHEMA;

    const toolDefinition: Record<string, unknown> = {
      name,
      title,
      description,
      inputSchema,
      annotations,
      execution: { taskSupport: 'forbidden' },
    };

    const totalChars = JSON.stringify(toolDefinition).length;
    const descChars = (description ?? '').length;
    const schemaChars = JSON.stringify(inputSchema).length;

    rows.push({ name, descChars, schemaChars, totalChars });
    total += totalChars;
  }

  const instrChars = DESKTOP_INSTRUCTIONS.length;
  total += instrChars;

  rows.sort((a, b) => b.totalChars - a.totalChars);

  console.log('name,descChars,schemaChars,totalChars');
  for (const r of rows) {
    console.log(`${r.name},${r.descChars},${r.schemaChars},${r.totalChars}`);
  }
  console.log(`SERVER_INSTRUCTIONS,${instrChars},0,${instrChars}`);
  console.log(`\nTOOL_COUNT=${tools.length}`);
  console.log(`GRAND_TOTAL=${total}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
