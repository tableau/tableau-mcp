// Search result quality — the agent must never be offered a command it cannot invoke.
//
// Live incident (v11 bundle): after a chart came out wrong the user said "warmer should be
// with color". The agent called search-commands ~10 times and was handed
// publish-workbook-to-workgroup, export-as-version, save-as, cell-size,
// launch-worksheet-title-rich-text-editor, copy-worksheet-formatting and three COLOR dialogs
// (LaunchQuantitativeColorDialog, GetWebQuantitativeColorDialog, GetWebCategoricalColorDialog)
// whose VizID parameter is flagged cannot_provide_from_mcp — they can never be called from
// MCP at all. Every surplus call costs ~8.6s in production.

import { readDataAsset } from '../assets.js';
import { checkCommandPolicy } from '../commandPolicy.js';
import { searchCommandsByKeywords } from './searchLibrary.js';

type ReferenceParameter = {
  direction?: string;
  local_name?: string;
  type_id?: string;
  required?: boolean;
  cannot_provide_from_mcp?: boolean;
};

type ReferenceCommand = {
  command_name?: string;
  fully_qualified_serialized_name?: string;
  parameters?: ReferenceParameter[];
};

type CommandsReference = {
  commands?: ReferenceCommand[];
  command_names_agent_can_invoke?: string[];
  non_mcp_friendly_param_types?: string[];
};

function loadReference(): CommandsReference {
  const raw = readDataAsset('tableau-desktop-commands-reference.json');
  if (raw === null) {
    throw new Error('tableau-desktop-commands-reference.json could not be read');
  }
  return JSON.parse(raw) as CommandsReference;
}

const reference = loadReference();
const allCommands = reference.commands ?? [];
const agentAllow = new Set(reference.command_names_agent_can_invoke ?? []);
const nonMcpTypes = new Set(reference.non_mcp_friendly_param_types ?? []);

/** A command the allow-list lets through today — the population search draws from. */
function agentAllowed(cmd: ReferenceCommand): boolean {
  return typeof cmd.command_name === 'string' && agentAllow.has(cmd.command_name);
}

/** An "in" parameter (required OR optional) whose value can never come from MCP. */
function hasUnprovidableInParam(cmd: ReferenceCommand): boolean {
  return (cmd.parameters ?? []).some(
    (param) =>
      param.direction === 'in' &&
      (param.cannot_provide_from_mcp === true ||
        (typeof param.type_id === 'string' && nonMcpTypes.has(param.type_id))),
  );
}

/** A REQUIRED unprovidable "in" parameter — the only case the old filter caught. */
function hasUnprovidableRequiredInParam(cmd: ReferenceCommand): boolean {
  return (cmd.parameters ?? []).some(
    (param) =>
      param.direction === 'in' &&
      param.required === true &&
      (param.cannot_provide_from_mcp === true ||
        (typeof param.type_id === 'string' && nonMcpTypes.has(param.type_id))),
  );
}

const unprovidable = allCommands.filter((cmd) => agentAllowed(cmd) && hasUnprovidableInParam(cmd));

/** The leak: unprovidable, but only via OPTIONAL params, so the old filter let it through. */
const leaking = unprovidable.filter((cmd) => !hasUnprovidableRequiredInParam(cmd));

const policyRefused = allCommands.filter(
  (cmd) =>
    agentAllowed(cmd) &&
    checkCommandPolicy(cmd.fully_qualified_serialized_name ?? '')?.action === 'refuse',
);

const COLOR_DIALOGS = [
  'tabdoc:launch-quantitative-color-dialog',
  'tabdoc:get-web-quantitative-color-dialog',
  'tabdoc:get-web-categorical-color-dialog',
];

function names(result: {
  commands?: Array<{ fully_qualified_serialized_name?: string }>;
}): string[] {
  return (result.commands ?? []).map((cmd) => cmd.fully_qualified_serialized_name ?? '');
}

describe('search-commands never offers an uninvocable command', () => {
  it('pins the census the filter has to remove', () => {
    // 38 allow-listed commands carry an "in" parameter MCP can never fill. Half of them
    // declare it REQUIRED and were already dropped; the other 19 declare it OPTIONAL
    // (every one DPI_VisualIDPM or DPI_ShelfSelectionModel) and leaked into results.
    expect(unprovidable).toHaveLength(38);
    expect(leaking).toHaveLength(19);
    expect(leaking.map((cmd) => cmd.fully_qualified_serialized_name).sort()).toContain(
      'tabdoc:launch-quantitative-color-dialog',
    );
    expect(policyRefused).toHaveLength(25);
  });

  it('drops every command with an unprovidable "in" parameter', () => {
    const offenders: string[] = [];
    for (const cmd of unprovidable) {
      const hits = names(searchCommandsByKeywords([cmd.command_name!]));
      if (hits.includes(cmd.fully_qualified_serialized_name!)) {
        offenders.push(cmd.fully_qualified_serialized_name!);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('drops the three color dialogs from a "color" search', () => {
    const hits = names(searchCommandsByKeywords(['color']));
    expect(hits.filter((name) => COLOR_DIALOGS.includes(name))).toEqual([]);
  });

  it('drops every command the policy layer refuses', () => {
    const offenders: string[] = [];
    for (const cmd of policyRefused) {
      const hits = names(searchCommandsByKeywords([cmd.command_name!]));
      if (hits.includes(cmd.fully_qualified_serialized_name!)) {
        offenders.push(cmd.fully_qualified_serialized_name!);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never reports a parameter it cannot fill on a returned command', () => {
    for (const query of [['color'], ['sort'], ['page'], ['legend'], []]) {
      const result = searchCommandsByKeywords(query) as {
        commands: Array<{
          fully_qualified_serialized_name: string;
          parameters: Array<{ direction?: string; cannot_provide_from_mcp?: boolean }>;
        }>;
      };
      for (const cmd of result.commands) {
        const bad = cmd.parameters.filter(
          (param) => param.direction === 'in' && param.cannot_provide_from_mcp,
        );
        expect(
          bad,
          `${cmd.fully_qualified_serialized_name} for query ${JSON.stringify(query)}`,
        ).toEqual([]);
      }
    }
  });
});

describe('search-commands routing recommendation', () => {
  it('returns the recommendation even when commands match', () => {
    const result = searchCommandsByKeywords(['sheet']) as {
      commands: unknown[];
      recommendation?: string;
    };
    expect(result.commands.length).toBeGreaterThan(0);
    expect(result.recommendation).toBeTypeOf('string');
  });

  it('names add-field/apply-worksheet for encoding edits and keeps refine-worksheet on top-N/sort', () => {
    const { recommendation } = searchCommandsByKeywords(['color']) as { recommendation?: string };
    expect(recommendation).toBeTypeOf('string');
    expect(recommendation).toContain('add-field');
    expect(recommendation).toContain('apply-worksheet');
    expect(recommendation).toContain('encoding');
    // refine-worksheet may still be named, but only for what it can actually do.
    expect(recommendation).not.toMatch(/refine-worksheet to edit in place/);
  });
});
