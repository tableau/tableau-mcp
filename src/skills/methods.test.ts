import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ErrorCode, type Result } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';

import { registerSkillMethodHandlers } from './methods.js';
import { type SkillRegistry } from './registry.js';
import {
  type SkillEntry,
  SkillsGetRequestSchema,
  SkillsGetResultSchema,
  SkillsListResultSchema,
} from './types.js';

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
// skills custom routing
async function requestSkills(
  registry: SkillRegistry,
  method: 'skills/list' | 'skills/get',
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
  try {
    return await client.request(
      { method, params },
      method === 'skills/get' ? SkillsGetResultSchema : SkillsListResultSchema,
    );
  } finally {
    await client.close();
    await mcpServer.close();
  }
}

function listSkills(registry: SkillRegistry, params?: Record<string, unknown>): Promise<Result> {
  return requestSkills(registry, 'skills/list', params);
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

describe('skills/get', () => {
  it('returns the complete entry for the requested SKILL.md URI', async () => {
    const otherSkill: SkillEntry = { ...SKILL, uri: 'skill://other-skill/SKILL.md' };
    const result = await requestSkills(makeRegistry([otherSkill, SKILL]), 'skills/get', {
      uri: SKILL.uri,
    });

    expect(result).toEqual({ resultType: 'complete', skill: SKILL });
  });

  it('returns the same complete entry advertised by skills/list', async () => {
    const registry = makeRegistry([SKILL]);
    const listed = await listSkills(registry, {});
    const result = await requestSkills(registry, 'skills/get', { uri: SKILL.uri });

    expect(result).toEqual({
      resultType: 'complete',
      skill: (listed.skills as SkillEntry[])[0],
    });
  });

  it.each([
    'skill://missing-skill/SKILL.md',
    'skill://test-skill/references/example.md',
    'skill://test-skill/skill.md',
    'https://example.com/SKILL.md',
    '',
  ])('returns InvalidParams for an unserved skill URI: %s', async (uri) => {
    await expect(requestSkills(makeRegistry([SKILL]), 'skills/get', { uri })).rejects.toMatchObject(
      {
        code: ErrorCode.InvalidParams,
      },
    );
  });

  it('returns InvalidParams when the registry is empty', async () => {
    await expect(
      requestSkills(makeRegistry([]), 'skills/get', { uri: SKILL.uri }),
    ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
  });

  it.each([undefined, {}, { uri: 42 }, { uri: null }])(
    'returns InvalidParams for invalid request params: %j',
    async (params) => {
      await expect(
        requestSkills(makeRegistry([SKILL]), 'skills/get', params),
      ).rejects.toMatchObject({
        code: ErrorCode.InvalidParams,
      });
    },
  );
});

describe('skills/get schemas', () => {
  it.each([null, 'invalid', []])('rejects non-object params: %j', (params) => {
    expect(SkillsGetRequestSchema.safeParse({ method: 'skills/get', params }).success).toBe(false);
  });

  it.each([
    { resultType: 'complete' },
    { resultType: 'partial', skill: SKILL },
    { resultType: 'complete', skill: { ...SKILL, frontmatter: { name: 'test-skill' } } },
    { resultType: 'complete', skill: { ...SKILL, resources: [{ uri: SKILL.uri }] } },
    {
      resultType: 'complete',
      skill: { ...SKILL, resources: [{ ...SKILL.resources[0], digest: 'sha256:invalid' }] },
    },
  ])('rejects an invalid result: %j', (result) => {
    expect(SkillsGetResultSchema.safeParse(result).success).toBe(false);
  });
});
