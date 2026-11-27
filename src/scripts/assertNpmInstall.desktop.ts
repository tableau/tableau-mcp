#!/usr/bin/env node

/* eslint-disable no-console */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

import { EXPERTISE_TOOL_NAMES } from '../desktop/instructions.js';
import { DYNAMIC_AUTHORING_TOOL_PROFILE } from '../server.desktop.js';

const skillToolNamePattern = /TableauDesktop__([a-z][a-z0-9-]*)/g;

function fail(message: string): never {
  throw new Error(message);
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

function findSkillToolNames(skillsDir: string): Set<string> {
  const names = new Set<string>();
  for (const file of listFiles(skillsDir)) {
    for (const match of readFileSync(file, 'utf8').matchAll(skillToolNamePattern)) {
      names.add(match[1]);
    }
  }
  return names;
}

async function main(): Promise<void> {
  const tarball = process.argv[2];
  if (!tarball || tarball.startsWith('--')) {
    fail(
      'usage: npx tsx src/scripts/assertNpmInstall.desktop.ts <tarball> [--skills-dir <plugin skills dir>]',
    );
  }
  const skillsDir = readArg('--skills-dir');

  const sandbox = mkdtempSync(join(tmpdir(), 'desktop-npm-install-'));
  try {
    const project = join(sandbox, 'project');
    const discoveryDir = join(sandbox, 'no-desktop');
    mkdirSync(project);
    mkdirSync(discoveryDir);
    writeFileSync(join(project, 'package.json'), '{ "private": true }\n');
    writeFileSync(join(project, '.env'), 'TOOL_PROFILE=demo\n');

    execFileSync('npm', ['install', '--no-audit', '--no-fund', resolve(tarball)], {
      cwd: project,
      stdio: 'inherit',
    });

    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['--no-install', 'tableau-mcp-server-desktop'],
      cwd: project,
      env: { PATH: process.env.PATH ?? '', TABLEAU_EXTERNAL_API_DISCOVERY_DIR: discoveryDir },
      stderr: 'pipe',
    });
    let stderr = '';
    transport.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const expectedToolNames = [...DYNAMIC_AUTHORING_TOOL_PROFILE]
      .filter((name) => !EXPERTISE_TOOL_NAMES.has(name))
      .sort();
    const client = new Client({ name: 'assert-desktop-npm-install', version: '1.0.0' });
    let toolNames: string[];
    let templatesText: string;
    try {
      await client.connect(transport);
      toolNames = (await client.listTools()).tools.map(({ name }) => name).sort();
      if (JSON.stringify(toolNames) !== JSON.stringify(expectedToolNames)) {
        fail(
          `the installed package did not list the default tools; was .env read?\nexpected: ${expectedToolNames.join(', ')}\nactual: ${toolNames.join(', ')}`,
        );
      }
      const templates = await client.callTool({ name: 'list-templates', arguments: { limit: 1 } });
      const content = templates.content as Array<{ type: string; text?: string }>;
      templatesText = content.map((part) => part.text ?? '').join('\n');
      if (templates.isError === true) {
        fail(`list-templates failed: ${templatesText.slice(0, 200)}`);
      }
    } finally {
      await client.close();
    }

    if (!/"template":/.test(templatesText)) {
      fail(`list-templates returned no templates: ${templatesText.slice(0, 200)}`);
    }
    if (stderr.includes('Failed to load feature config')) {
      fail('the installed package could not read features.json');
    }

    if (skillsDir) {
      if (!existsSync(skillsDir)) {
        console.log(
          `No Desktop plugin skills at ${skillsDir}; skipping the skill tool-name check.`,
        );
      } else {
        const listed = new Set(toolNames);
        const missing = [...findSkillToolNames(skillsDir)].filter((name) => !listed.has(name));
        if (missing.length > 0) {
          fail(`plugin skills name tools the server does not list: ${missing.join(', ')}`);
        }
      }
    }

    console.log(
      `Desktop npm install OK: ${toolNames.length} tools listed, templates loaded, .env ignored`,
    );
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(
    `Desktop npm install check failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
