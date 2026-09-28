import { readFile } from 'node:fs/promises';

import { type ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

import { getFeatureGate } from '../features/init.js';
import { log } from '../logging/logger.js';
import { type Server } from '../server.js';
import { getSkillRegistry } from './registry.js';

const LOGGER = 'skills';

// registeredServer tracks if a server already has registered its skills. Guards against
// double-registration on the combined variant, where WebMcpServer and DesktopMcpServer both run
// registerTools() against the *same* shared McpServer and registerResource throws on a duplicate
// URI. HTTP mode builds a fresh McpServer per request, so this never suppresses across requests.
const registeredServer = new WeakSet<object>();

// Files whose MIME type is textual are served as UTF-8 `text`; everything else as a base64 binary blob
function isTextMimeType(mimeType: string): boolean {
  return mimeType.startsWith('text/') || /(?:json|xml|javascript|yaml|csv|markdown)/.test(mimeType);
}

/**
 * When skills-over-mcp is enabled, this is called once on startup. Serves every skill file
 * as an individual `resources/read` resource so clients can fetch `SKILL.md` and its referenced
 * files on demand. If called multiple times, skills are still only registered once.
 */
export async function registerSkills(server: Server): Promise<void> {
  if (!(await getFeatureGate().isFeatureEnabled('skills-over-mcp'))) {
    return;
  }

  const mcp = server.mcpServer;
  if (registeredServer.has(mcp)) {
    return;
  }
  // Track this specific server instance: HTTP builds a fresh McpServer per
  // request that must each register, while the combined variant shares one server across the web +
  // desktop registerTools() paths and must register only once.
  registeredServer.add(mcp);

  const registry = await getSkillRegistry();
  const files = registry.files();

  if (files.length === 0) {
    log({
      level: 'info',
      message: 'No skills to register; serving 0 skill resources.',
      logger: LOGGER,
    });
    return;
  }

  for (const { uri, path, mimeType } of files) {
    // The URI is unique per file, so it doubles as the resource's registration name.
    mcp.registerResource(uri, uri, { mimeType }, async (): Promise<ReadResourceResult> => {
      const bytes = await readFile(path);
      return {
        contents: [
          isTextMimeType(mimeType)
            ? { uri, mimeType, text: bytes.toString('utf-8') }
            : { uri, mimeType, blob: bytes.toString('base64') },
        ],
      };
    });
  }

  log({
    level: 'info',
    message: `Registered ${files.length} skill resource(s).`,
    logger: LOGGER,
  });
}
