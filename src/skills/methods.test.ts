import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ErrorCode, type Result } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../logging/logger.js', () => ({
  log: vi.fn(),
}));

import { registerSkillMethodHandlers } from './methods.js';
import { buildSkillRegistry, MAX_SKILLS_PAGE_SIZE, type SkillRegistry } from './registry.js';
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

type ListPage = { resultType: string; skills: SkillEntry[]; nextCursor?: string };

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

describe('skills/list pagination', () => {
  const N = MAX_SKILLS_PAGE_SIZE;
  const encode = (text: string): string => Buffer.from(text).toString('base64url');
  const skillUri = (i: number): string => `skill://skill-${String(i).padStart(4, '0')}/SKILL.md`;
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Build a real registry from `count` tiny skills on disk (SKILL.md + extra.md each).
  const realRegistry = (count: number): SkillRegistry => {
    const dir = mkdtempSync(join(tmpdir(), 'skills-methods-'));
    dirs.push(dir);
    for (let i = 0; i < count; i++) {
      const name = `skill-${String(i).padStart(4, '0')}`;
      mkdirSync(join(dir, name));
      writeFileSync(join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: tiny\n---\n`);
      writeFileSync(join(dir, name, 'extra.md'), name);
    }
    return buildSkillRegistry(dir);
  };

  const fetchPages = async (registry: SkillRegistry): Promise<ListPage[]> => {
    const pages: ListPage[] = [];
    let cursor: string | undefined;
    do {
      // A repeated or non-advancing cursor must fail fast rather than loop forever.
      expect(pages.length).toBeLessThanOrEqual(10);
      const page = (await listSkills(registry, cursor === undefined ? {} : { cursor })) as ListPage;
      pages.push(page);
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    return pages;
  };

  it.each([
    [0, [0]],
    [1, [1]],
    [N, [N]],
    [N + 1, [N, 1]],
    [2 * N, [N, N]],
    [2 * N + 1, [N, N, 1]],
  ])('pages the built registry of %i skills over MCP as %j', async (count, pageSizes) => {
    const pages = await fetchPages(realRegistry(count));

    expect(pages.map((p) => p.skills.length)).toEqual(pageSizes);
    pages.forEach((page, i) => {
      expect(page.resultType).toBe('complete');
      expect('nextCursor' in page).toBe(i < pages.length - 1);
    });
    const skills = pages.flatMap((p) => p.skills);
    expect(skills.map((s) => s.uri)).toEqual(Array.from({ length: count }, (_, i) => skillUri(i)));
    expect(skills.every((s) => s.resources.length === 2)).toBe(true);
  });

  // Client-side token opacity: an empty-string nextCursor is still a token and must be echoed
  // verbatim. (The production registry never issues one and rejects it as an input.)
  it('echoes an empty-string nextCursor verbatim when paging', async () => {
    const otherSkill: SkillEntry = { ...SKILL, uri: 'skill://other-skill/SKILL.md' };
    const received: Array<string | undefined> = [];
    const registry: SkillRegistry = {
      ...makeRegistry([SKILL, otherSkill]),
      list: (cursor) => {
        received.push(cursor);
        if (received.length === 1) {
          return { skills: [SKILL], nextCursor: '' };
        }
        if (cursor !== '') {
          throw new Error('continuation must send the empty cursor verbatim');
        }
        return { skills: [otherSkill] };
      },
    };

    const pages = await fetchPages(registry);

    expect(pages).toHaveLength(2);
    expect(pages.flatMap((p) => p.skills)).toEqual([SKILL, otherSkill]);
    expect(received).toEqual([undefined, '']);
    expect('nextCursor' in pages[1]).toBe(false);
  });

  it('serves the same page for a retried cursor', async () => {
    const registry = realRegistry(N + 1);
    const first = (await listSkills(registry, {})) as ListPage;

    const a = await listSkills(registry, { cursor: first.nextCursor });
    const b = await listSkills(registry, { cursor: first.nextCursor });

    expect(a).toEqual(b);
  });

  it('treats no params and {} as the first page', async () => {
    const registry = realRegistry(N + 1);

    const noParams = (await listSkills(registry)) as ListPage;

    expect(noParams).toEqual(await listSkills(registry, {}));
    expect(noParams.skills).toHaveLength(N);
    expect(noParams.nextCursor).toBeDefined();
  });

  it('keeps get() and files() covering skills beyond the first page', async () => {
    const registry = realRegistry(N + 1);

    const result = await requestSkills(registry, 'skills/get', { uri: skillUri(N) });

    expect(result).toMatchObject({ resultType: 'complete', skill: { uri: skillUri(N) } });
    expect(registry.files()).toHaveLength((N + 1) * 2);
  });

  it.each([
    ['empty', ''],
    ['not base64url', 'not base64!'],
    ['unknown version', encode('v2:1')],
    ['negative', encode('v1:-1')],
    ['float', encode('v1:1.5')],
    ['unsafe', encode('v1:9007199254740993')],
    ['out of range', encode('v1:999')],
    ['wrong type number', 42],
    ['wrong type null', null],
    ['wrong type object', {}],
    ['wrong type array', ['x']],
  ])('returns InvalidParams for a %s cursor without echoing it', async (_label, cursor) => {
    const error = await listSkills(realRegistry(N + 1), { cursor }).catch((e) => e);

    expect(error).toMatchObject({ code: ErrorCode.InvalidParams });
    if (typeof cursor === 'string' && cursor.length > 0) {
      expect(error.message).not.toContain(cursor);
    }
  });

  it('does not report unrelated registry failures as invalid params', async () => {
    const registry: SkillRegistry = {
      ...makeRegistry([]),
      list: () => {
        throw new Error('registry exploded at /secret/path');
      },
    };

    const error = await listSkills(registry, {}).catch((e) => e);

    expect(error).toMatchObject({ code: ErrorCode.InternalError });
  });
});

describe('skills/list schemas', () => {
  it.each([{}, { nextCursor: 'abc' }])('accepts a valid result: %j', (extra) => {
    expect(
      SkillsListResultSchema.safeParse({ resultType: 'complete', skills: [], ...extra }).success,
    ).toBe(true);
  });

  it.each([{ nextCursor: null }, { nextCursor: 5 }, { resultType: 'partial' }])(
    'rejects an invalid result: %j',
    (extra) => {
      expect(
        SkillsListResultSchema.safeParse({ resultType: 'complete', skills: [], ...extra }).success,
      ).toBe(false);
    },
  );
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
