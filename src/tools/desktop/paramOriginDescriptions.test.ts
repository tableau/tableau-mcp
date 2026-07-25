import { z } from 'zod';

import { DesktopMcpServer } from '../../server.desktop.js';
import { Provider } from '../../utils/provider.js';
import { desktopToolNames } from './toolName.js';
import { desktopToolFactories } from './tools.js';

/**
 * A parameter whose value the agent must OBTAIN FROM SOMEWHERE ELSE has to say where it
 * comes from. Shipped v10 said 'Workbook.' and 'Session.', and 'Fetched fresh.', so the
 * agent sent a WORKSHEET NAME where a cache path belonged and then cycled session='pinned'
 * / omitted / 'x' against a contract no value could satisfy. bind-template's
 * target_worksheet said nothing at all, so an edit-in-place ask built a second sheet and
 * every later call chased it. Measured: 69 failed add-field calls (591s), 299 repeat binds
 * (2,562s), one conversation the user killed.
 *
 * WHAT THIS GATE CHECKS
 *   1. every parameter of a covered tool carries description text;
 *   2. that text is more than a single word (a label is not a description);
 *   3. a parameter in the origin class — a path, a session id, or the name of something
 *      that must already exist — names a real tool from the registry, or says what
 *      happens when it is left out. Those are the only two honest answers to "where do I
 *      get this?", and neither can be produced by padding: the tool name is checked
 *      against desktopToolNames;
 *   4. surface-wide: no tool makes `session` REQUIRED. Required + a pin the agent cannot
 *      name is the impossible contract itself — the tool refuses every value it accepts.
 *
 * WHAT THIS GATE CANNOT CHECK
 *   It cannot tell whether a description is TRUE. It cannot tell whether the tool it names
 *   actually returns that value, whether the text still matches the code after a refactor,
 *   or whether an enum explains when to pick which member. A description that says
 *   "path from resolve-field" about a parameter resolve-field never returns passes here and
 *   fails a human review. Accuracy is a review job; presence and origin are this test's job.
 *
 * SCOPE — deliberately the four tools fixed in this change, not the whole surface.
 *   368 parameters were scanned across the desktop tools: 252 carry no description at all
 *   and 73 more carry a stub of <= 24 characters. A surface-wide gate would fail the build
 *   today, so it would have to ship disabled or with a 300-entry allow-list, and neither is
 *   a gate. Rule 4 (session never required) IS surface-wide because the surface already
 *   passes it. TODO: move tools into COVERED_TOOLS as their parameters are described; the
 *   gate needs no other change.
 */
const COVERED_TOOLS: ReadonlySet<string> = new Set([
  'add-field',
  'resolve-field',
  'bind-template',
  'inject-template',
]);

/**
 * Exemptions inside the covered tools. Small on purpose — every entry is a decision, and a
 * long list here means the gate has been talked out of its job.
 */
const EXEMPT: Readonly<Record<string, readonly string[]>> = {
  'bind-template': [
    // Self-evident from the name and the type: a boolean that applies the bind, and a 0..1
    // floor. Neither is a value fetched from anywhere.
    'auto_apply',
    'minConfidence',
    // The Call-1 propose payload echoed back verbatim, and the calcs to author alongside the
    // bind. Both are objects whose own members carry the contract (proposalSchema), and this
    // change did not touch them. TODO with the rest of the surface.
    'proposal',
    'calcs',
    // KNOWN GAP, not a self-evident parameter: bind-template auto-resolves the session and
    // this parameter is already optional, but it should still say so. It is not described
    // here because bind-template sits at its per-tool byte cap (server.desktop.test.ts) and
    // the honest describe does not fit without trimming that tool's other prose — a separate
    // change. Rule 4 still covers it.
    'session',
  ],
};

/**
 * The origin class: a path minted by another call, a session id, or the name of a sheet /
 * template that must already exist. These are the values an agent cannot invent, and every
 * value in the v10 failure was one of them.
 */
function comesFromElsewhere(param: string): boolean {
  return param === 'session' || /File$/.test(param) || /(Name|_worksheet)$/.test(param);
}

function namesAnotherTool(description: string): boolean {
  return desktopToolNames.some((name) => description.includes(name));
}

function saysWhatOmittingDoes(description: string): boolean {
  return /\bomit\b/i.test(description);
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
  it('describes every parameter of a covered tool', async () => {
    const offenders: string[] = [];

    for (const [toolName, schema] of await schemasByToolName()) {
      if (!COVERED_TOOLS.has(toolName)) continue;
      const exempt = EXEMPT[toolName] ?? [];

      for (const [param, type] of Object.entries(schema)) {
        if (exempt.includes(param)) continue;
        const description = type.description?.trim() ?? '';

        if (description === '') {
          offenders.push(`${toolName}.${param}: no description`);
          continue;
        }
        // The weakest of the rules, and it stands alone only because every stub that
        // shipped was one word: 'Session.', 'Shelf.', 'Workbook.', 'Position.', 'Fields.'.
        if (!/\s/.test(description)) {
          offenders.push(`${toolName}.${param}: "${description}" is a label, not a description`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('tells the agent where an obtained value comes from', async () => {
    const offenders: string[] = [];

    for (const [toolName, schema] of await schemasByToolName()) {
      if (!COVERED_TOOLS.has(toolName)) continue;
      const exempt = EXEMPT[toolName] ?? [];

      for (const [param, type] of Object.entries(schema)) {
        if (exempt.includes(param) || !comesFromElsewhere(param)) continue;
        const description = type.description?.trim() ?? '';

        if (!namesAnotherTool(description) && !saysWhatOmittingDoes(description)) {
          offenders.push(
            `${toolName}.${param}: "${description}" names no tool that returns it and does not say what omitting it does`,
          );
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('never makes session required, on any tool', async () => {
    const required: string[] = [];

    for (const [toolName, schema] of await schemasByToolName()) {
      for (const [param, type] of Object.entries(schema)) {
        if (param === 'session' && !type.isOptional()) {
          required.push(`${toolName}.${param}`);
        }
      }
    }

    // A pinned agent is told to omit the parameter; a required parameter tells it to send
    // one. The tool then refuses every value in the set it accepts, and the agent loops.
    expect(required).toEqual([]);
  });
});
