#!/usr/bin/env node

/* eslint-disable no-console */

// Runs the built Desktop bundle from a temp dir outside the repo and checks it reads its own
// staged data (build/desktop/data), not the repo's src/desktop/data. It cannot reach a Tableau
// Desktop, so it checks asset resolution through read-only search tools only.
import { cpSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

type ToolText = { isError: boolean; text: string };

function fail(message: string): never {
  throw new Error(message);
}

async function callTools(entry: string, cwd: string): Promise<Record<string, ToolText>> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    cwd,
    env: { PATH: process.env.PATH ?? '', TRANSPORT: 'stdio', TOOL_PROFILE: 'full' },
    stderr: 'inherit',
  });
  const client = new Client({ name: 'assert-desktop-bundle', version: '1.0.0' });
  try {
    await client.connect(transport);
    const calls: Record<string, { name: string; arguments: Record<string, unknown> }> = {
      corpus: {
        name: 'search-workbook-examples',
        arguments: { query: 'dual axis', source: 'diff-corpus' },
      },
      twbIndex: { name: 'search-workbook-examples', arguments: { feature: 'dual-axis' } },
      schema: { name: 'lookup-workbook-schema', arguments: { query: 'PrimitiveType-ST' } },
    };
    const results: Record<string, ToolText> = {};
    for (const [key, call] of Object.entries(calls)) {
      const result = await client.callTool(call);
      const content = result.content as Array<{ type: string; text?: string }>;
      results[key] = {
        isError: result.isError === true,
        text: content.map((part) => part.text ?? '').join('\n'),
      };
    }
    return results;
  } finally {
    await client.close();
  }
}

async function main(): Promise<void> {
  const repoRoot = realpathSync(resolve(process.cwd()));
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'desktop-bundle-')));
  if (!relative(repoRoot, sandbox).startsWith('..')) {
    fail(`temp dir ${sandbox} is inside the repo ${repoRoot}`);
  }

  try {
    cpSync(join(repoRoot, 'build'), join(sandbox, 'build'), { recursive: true });
    const entry = join(sandbox, 'build', 'index.desktop.js');

    const loaded = await callTools(entry, sandbox);
    if (loaded.corpus.isError || !/Found \d+ example/.test(loaded.corpus.text)) {
      fail(`corpus.json did not load from ${sandbox}: ${loaded.corpus.text.slice(0, 200)}`);
    }
    if (loaded.twbIndex.isError || !/"twbTotal": [1-9]/.test(loaded.twbIndex.text)) {
      fail(
        `twb-example-index.json did not load from ${sandbox}: ${loaded.twbIndex.text.slice(0, 200)}`,
      );
    }
    if (loaded.schema.isError) {
      fail(`twb XSD did not load from ${sandbox}: ${loaded.schema.text.slice(0, 200)}`);
    }

    // Control: the repo layout, with the data only under <root>/src and none in build/. A bundle
    // that falls back to ../src/desktop/data would load it; this one must not.
    mkdirSync(join(sandbox, 'src', 'desktop'), { recursive: true });
    renameSync(join(sandbox, 'build', 'desktop', 'data'), join(sandbox, 'src', 'desktop', 'data'));
    console.log('Control run: the bundle has no data, so the errors below are expected.');
    const withoutOwnData = await callTools(entry, sandbox);
    if (!withoutOwnData.corpus.isError || !withoutOwnData.schema.isError) {
      fail(
        `the bundle loaded data from ${sandbox}/src/desktop/data instead of its own build/desktop/data`,
      );
    }

    console.log(
      `Desktop bundle OK: corpus, twb index and schema loaded from ${sandbox}/build/desktop/data`,
    );
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(
    `Desktop bundle check failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
