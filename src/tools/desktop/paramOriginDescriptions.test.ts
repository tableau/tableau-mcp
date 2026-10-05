import { z } from 'zod';

import { DesktopMcpServer, DYNAMIC_AUTHORING_TOOL_PROFILE } from '../../server.desktop.js';
import { Provider } from '../../utils/provider.js';
import { type DesktopToolName, desktopToolNames } from './toolName.js';
import { desktopToolFactories } from './tools.js';

/**
 * Opaque values cannot be invented from the parameter name alone. Their descriptions must
 * explain the value semantically, without coupling one tool's contract to another tool's
 * name. Optional opaque values must also explain what happens when they are not supplied.
 *
 * WHAT THIS GATE CHECKS
 *   1. every covered opaque parameter has description text;
 *   2. no parameter description on the served surface names any registered tool, in either
 *      kebab-case or underscore_case;
 *   3. every optional covered opaque parameter describes its omission/default behavior;
 *   4. every required covered opaque parameter states a semantic source.
 *
 * WHAT THIS GATE CANNOT CHECK
 *   It cannot prove that prose matches runtime behavior. Accuracy remains a review job; this
 *   test prevents missing provenance, missing omission behavior, and cross-tool coupling.
 *
 * SCOPE
 *   Semantic provenance and omission checks cover the four tools repaired by this gate.
 *   The registered-name prohibition is surface-wide for the default served profile.
 */
const COVERED_TOOLS: ReadonlySet<string> = new Set([
  'add-field',
  'resolve-field',
  'bind-template',
  'inject-template',
]);

/**
 * The origin class: a path minted by another call, a session id, or the name of a sheet /
 * template that must already exist. These are the values an agent cannot invent, and every
 * value in the v10 failure was one of them.
 */
function isOpaque(param: string): boolean {
  return param === 'session' || /File$/.test(param) || /(Name|_worksheet)$/.test(param);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const REGISTERED_TOOL_PATTERNS: ReadonlyArray<readonly [DesktopToolName, RegExp]> =
  desktopToolNames.flatMap((name) => {
    const spellings = new Set([name, name.replaceAll('-', '_')]);
    return [...spellings].map(
      (spelling) =>
        [
          name,
          new RegExp(`(^|[^a-z0-9_-])${escapeRegExp(spelling)}(?=$|[^a-z0-9_-])`, 'i'),
        ] as const,
    );
  });

function namedRegisteredTool(description: string): DesktopToolName | undefined {
  return REGISTERED_TOOL_PATTERNS.find(([, pattern]) => pattern.test(description))?.[0];
}

function saysWhatOmittingDoes(description: string): boolean {
  return description.split(/[.!?]+/).some((sentence) => {
    const omissionWord = /\b(?:omit(?:ted)?|defaults?)\b/i;
    if (!omissionWord.test(sentence)) return false;
    return /[a-z0-9]+/i.test(sentence.replace(omissionWord, ''));
  });
}

function statesSemanticSource(description: string): boolean {
  return (
    description.trim().split(/\s+/).length > 1 &&
    /\b(?:cached|created|existing|live|current|produced|provided|resolved|returned|selected|supplied)\b/i.test(
      description,
    )
  );
}

async function schemasByToolName(): Promise<Map<string, Record<string, z.ZodTypeAny>>> {
  const server = new DesktopMcpServer();
  const schemas = new Map<string, Record<string, z.ZodTypeAny>>();
  for (const factory of desktopToolFactories) {
    const tool = factory(server);
    const paramsSchema = (await Provider.from(tool.paramsSchema)) as
      | Record<string, z.ZodTypeAny>
      | undefined;
    schemas.set(tool.name, paramsSchema ?? {});
  }
  return schemas;
}

describe('tool input schemas say what to send', () => {
  it('describes every covered opaque parameter', async () => {
    const offenders: string[] = [];

    for (const [toolName, schema] of await schemasByToolName()) {
      if (!COVERED_TOOLS.has(toolName)) continue;

      for (const [param, type] of Object.entries(schema)) {
        if (!isOpaque(param)) continue;
        const description = type.description?.trim() ?? '';

        if (description === '') {
          offenders.push(`${toolName}.${param}: no description`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('names no registered tool in any served parameter description', async () => {
    const offenders: string[] = [];

    for (const [toolName, schema] of await schemasByToolName()) {
      if (!DYNAMIC_AUTHORING_TOOL_PROFILE.has(toolName as DesktopToolName)) continue;

      for (const [param, type] of Object.entries(schema)) {
        const description = type.description?.trim() ?? '';
        const namedTool = namedRegisteredTool(description);

        if (namedTool) {
          offenders.push(`${toolName}.${param}: names registered tool "${namedTool}"`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('states omission behavior for every optional covered opaque parameter', async () => {
    const offenders: string[] = [];

    for (const [toolName, schema] of await schemasByToolName()) {
      if (!COVERED_TOOLS.has(toolName)) continue;

      for (const [param, type] of Object.entries(schema)) {
        if (!isOpaque(param) || !type.isOptional()) continue;
        const description = type.description?.trim() ?? '';

        if (!saysWhatOmittingDoes(description)) {
          offenders.push(`${toolName}.${param}: does not state what omission defaults to`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('states a semantic source for every required covered opaque parameter', async () => {
    const offenders: string[] = [];

    for (const [toolName, schema] of await schemasByToolName()) {
      if (!COVERED_TOOLS.has(toolName)) continue;

      for (const [param, type] of Object.entries(schema)) {
        if (!isOpaque(param) || type.isOptional()) continue;
        const description = type.description?.trim() ?? '';

        if (!statesSemanticSource(description)) {
          offenders.push(`${toolName}.${param}: does not state a semantic source`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('never requires session on any served tool', async () => {
    const offenders: string[] = [];

    for (const [toolName, schema] of await schemasByToolName()) {
      const session = schema['session'];
      if (session !== undefined && !session.isOptional()) {
        offenders.push(`${toolName}.session: required — session must always be optional`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
