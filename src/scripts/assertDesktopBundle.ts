#!/usr/bin/env node

/* eslint-disable no-console */

// Runs the built Desktop bundle from a temp dir outside the repo and checks it reads its own
// staged data (build/desktop/data), not the repo's src/desktop/data. It cannot reach a Tableau
// Desktop, so it checks asset resolution through the read-only list-templates tool only.
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
      templates: { name: 'list-templates', arguments: { limit: 1 } },
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
    if (loaded.templates.isError || !/"template":/.test(loaded.templates.text)) {
      fail(`templates did not load from ${sandbox}: ${loaded.templates.text.slice(0, 200)}`);
    }

    // Control: the repo layout, with the data only under <root>/src and none in build/. A bundle
    // that falls back to ../src/desktop/data would load it; this one must not.
    mkdirSync(join(sandbox, 'src', 'desktop'), { recursive: true });
    renameSync(join(sandbox, 'build', 'desktop', 'data'), join(sandbox, 'src', 'desktop', 'data'));
    console.log('Control run: the bundle has no data, so the errors below are expected.');
    const withoutOwnData = await callTools(entry, sandbox);
    if (!withoutOwnData.templates.isError && /"template":/.test(withoutOwnData.templates.text)) {
      fail(
        `the bundle loaded data from ${sandbox}/src/desktop/data instead of its own build/desktop/data`,
      );
    }

    console.log(`Desktop bundle OK: templates loaded from ${sandbox}/build/desktop/data`);
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
