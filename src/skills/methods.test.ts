import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { type Result, ResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';

import { registerSkillMethodHandlers } from './methods.js';
import { type SkillRegistry } from './registry.js';
import { type SkillEntry } from './types.js';

const SKILL: SkillEntry = {
  uri: 'skill://test-skill/SKILL.md',
  frontmatter: { name: 'test-skill', description: 'A test skill.' },
  resources: [
    { uri: 'skill://test-skill/SKILL.md', digest: `sha256:${'a'.repeat(64)}`, size: 12 },
    {
      uri: 'skill://test-skill/references/example.md',
      digest: `sha256:${'b'.repeat(64)}`,
      size: 34,
    },
  ],
};

function makeRegistry(skills: SkillEntry[]): SkillRegistry {
  return {
    list: () => ({ skills }),
    get: (uri) => skills.find((s) => s.uri === uri),
    files: () => [],
  };
}

// We need to create a real mcpServer rather than testSetup's mock mcpServer in order to test
// skills/list custom routing
async function listSkills(
  registry: SkillRegistry,
  params?: Record<string, unknown>,
): Promise<Result> {
  const { McpServer } = await vi.importActual<
    typeof import('@modelcontextprotocol/sdk/server/mcp.js')
  >('@modelcontextprotocol/sdk/server/mcp.js');
  const mcpServer = new McpServer({ name: 'test', version: '0.0.0' });
  registerSkillMethodHandlers(mcpServer, registry);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([mcpServer.connect(serverTransport), client.connect(clientTransport)]);
  const result = await client.request({ method: 'skills/list', params }, ResultSchema);
  await client.close();

  return result;
}

describe('skills/list', () => {
  it('returns every skill entry with resultType complete', async () => {
    const result = await listSkills(makeRegistry([SKILL]), {});

    expect(result).toEqual({ resultType: 'complete', skills: [SKILL] });
  });

  it('accepts a request with no params', async () => {
    const result = await listSkills(makeRegistry([SKILL]));

    expect(result).toEqual({ resultType: 'complete', skills: [SKILL] });
  });

  it('returns an empty list when there are no skills', async () => {
    const result = await listSkills(makeRegistry([]), {});

    expect(result).toEqual({ resultType: 'complete', skills: [] });
  });
});
