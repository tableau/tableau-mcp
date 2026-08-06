import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { validateWorkbookDocumentApply } from '../../../../desktop/guards/workbookDocumentGuard.js';
import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import { getWorkbookXml } from '../../../../desktop/wrappers/getWorkbookXml.js';
import { applyWorkbookText } from '../../../../desktop/wrappers/loadWorkbookXml.js';
import { pollReadback } from '../../../../desktop/wrappers/pollReadback.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  XmlModificationError,
} from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { sessionParam } from '../../params.js';
import { DesktopTool } from '../../tool.js';

const activationSchema = z.enum(['on-select', 'on-hover', 'on-menu']);
const modeSchema = z.enum(['parameter', 'set']);
const setMembershipSchema = z.enum(['assign', 'add', 'remove']);
const clearSelectionSchema = z.enum(['do-nothing', 'show-all', 'exclude-all']);

// Primitives in, parameter/set action XML server-side, readback out. An action
// wires a mark interaction on a source sheet to a target parameter or set.
// PROVEN live 2026-07-19 (CODA): a workbook-level <actions> block MERGES via the
// document round-trip — the action survived readback with the target-parameter link
// intact. This is the interactivity layer over the key signature.
const paramsSchema = {
  session: sessionParam(),
  mode: modeSchema.default('parameter').describe(''),
  caption: z.string().describe(''),
  sourceWorksheet: z.string().describe(''),
  sourceField: z.string().optional().describe(''),
  targetParameter: z.string().optional().describe(''),
  targetSet: z.string().optional().describe(''),
  datasource: z.string().optional().describe(''),
  setMembership: setMembershipSchema.default('assign').describe(''),
  clearSelection: clearSelectionSchema.default('do-nothing').describe(''),
  singleSelect: z.boolean().optional().describe(''),
  activation: activationSchema.default('on-select').describe(''),
};

type AuthorActionResultBase = {
  actionName: string;
  caption: string;
  target: string;
  hint: string;
};

type AuthorActionResult = AuthorActionResultBase &
  (
    | {
        mode: 'parameter';
        targetParameter: string;
      }
    | {
        mode: 'set';
        targetSet: string;
      }
  );

type DatasourceElement = {
  name: string;
  caption?: string;
  xml: string;
};

type SetCandidate = {
  datasourceName: string;
  datasourceCaption?: string;
  name: string;
  caption?: string;
};

const title = 'Author Action';
export const getAuthorActionTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'author-action',
    title,
    description: 'Author action.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    callback: async (
      {
        session,
        mode = 'parameter',
        caption,
        sourceWorksheet,
        sourceField,
        targetParameter,
        targetSet,
        datasource,
        setMembership = 'assign',
        clearSelection = 'do-nothing',
        singleSelect,
        activation = 'on-select',
      },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute<AuthorActionResult>({
        extra,
        args: {
          session,
          mode,
          caption,
          sourceWorksheet,
          sourceField,
          targetParameter,
          targetSet,
          datasource,
          setMembership,
          clearSelection,
          singleSelect,
          activation,
        },
        callback: async () => {
          if (caption.trim().length === 0) {
            return new ArgsValidationError('caption empty').toErr();
          }
          if (sourceWorksheet.trim().length === 0) {
            return new ArgsValidationError('sourceWorksheet empty').toErr();
          }
          if (mode === 'set' && (targetParameter?.trim().length ?? 0) > 0) {
            return new ArgsValidationError(
              'targetParameter is not allowed in set mode; use targetSet',
            ).toErr();
          }
          if (mode === 'parameter') {
            if ((targetSet?.trim().length ?? 0) > 0) {
              return new ArgsValidationError(
                'targetSet is not allowed in parameter mode; use targetParameter',
              ).toErr();
            }
            if (sourceField === undefined) {
              return new ArgsValidationError('sourceField is required in parameter mode').toErr();
            }
            if (targetParameter === undefined || targetParameter.trim().length === 0) {
              return new ArgsValidationError(
                'targetParameter is required in parameter mode',
              ).toErr();
            }
            if (!/^\[.+\]\.\[.+\]$/.test(targetParameter.trim())) {
              return new ArgsValidationError(
                'targetParameter must be fully qualified like [Parameters].[X]; unqualified targets can cause a blocking Tableau modal',
              ).toErr();
            }
          }

          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }

          const executor = await extra.getExecutor(sessionResult.value);
          const readResult = await getWorkbookXml({ executor, signal: extra.signal });
          if (readResult.isErr()) {
            return new DesktopCommandExecutionError(readResult.error).toErr();
          }

          const liveXml = readResult.value;
          if (hasActionCaption(liveXml, caption)) {
            return new ArgsValidationError(
              'caption collision — pick a new caption or edit the existing action',
            ).toErr();
          }

          const actionName = nextActionName(liveXml);
          let target: string;
          let actionXml: string;
          if (mode === 'set') {
            const targetResult = resolveTargetSet(liveXml, targetSet, datasource);
            if (targetResult.isErr()) {
              return targetResult.error.toErr();
            }
            target = targetResult.value;
            actionXml = renderSetAction({
              caption,
              actionName,
              sourceWorksheet,
              targetSet: target,
              setMembership,
              clearSelection,
              singleSelect,
              activation,
            });
          } else {
            target = targetParameter!.trim();
            actionXml = renderParameterAction({
              caption,
              actionName,
              sourceWorksheet,
              sourceField: sourceField ?? '',
              targetParameter: target,
              activation,
            });
          }
          const editResult = spliceActionIntoWorkbook(liveXml, actionXml);
          if (editResult.isErr()) {
            return editResult.error.toErr();
          }
          const editedXml = editResult.value;

          const validation = validateWorkbookDocumentApply(editedXml, liveXml);
          if (!validation.ok) {
            return new ArgsValidationError(validation.message).toErr();
          }

          const loadResult = await applyWorkbookText({
            xml: editedXml,
            focus: { navigate: 'restore' },
            executor,
            signal: extra.signal,
          });
          if (loadResult.isErr()) {
            return new DesktopCommandExecutionError(loadResult.error).toErr();
          }

          const targetParamLanded = (xml: string): boolean =>
            mode === 'set'
              ? hasActionWithTargetParam(xml, 'edit-group-action', caption, 'target-group', target)
              : hasActionWithTargetParam(
                  xml,
                  'edit-parameter-action',
                  caption,
                  'target-parameter',
                  target,
                );
          const readback = await pollReadback({
            read: () => getWorkbookXml({ executor, signal: extra.signal }),
            settled: targetParamLanded,
            signal: extra.signal,
          });
          if (!readback.ok) {
            return new DesktopCommandExecutionError(readback.error).toErr();
          }
          if (!readback.settled) {
            return new XmlModificationError(
              mode === 'set'
                ? 'action applied but the target-group param did not survive readback'
                : 'action applied but the target-parameter param did not survive readback',
            ).toErr();
          }

          if (mode === 'set') {
            return new Ok({
              actionName,
              caption,
              mode,
              target,
              targetSet: target,
              hint: 'readback verified the qualified target set; the source sheet must expose marks that can drive the action',
            });
          }
          return new Ok({
            actionName,
            caption,
            mode,
            target,
            targetParameter: target,
            hint: 'the source sheet must expose the source field; the target parameter must already exist (author it at open time)',
          });
        },
      });
    },
  });

  return tool;
};

function hasActionCaption(xml: string, caption: string): boolean {
  return [...xml.matchAll(/<(?:action|edit-parameter-action|edit-group-action)\b[^>]*>/g)].some(
    (match) => unescapeXml(getAttr(match[0], 'caption') ?? '') === caption,
  );
}

function hasActionWithTargetParam(
  xml: string,
  elementName: 'edit-group-action' | 'edit-parameter-action',
  caption: string,
  paramName: 'target-group' | 'target-parameter',
  target: string,
): boolean {
  const actionPattern = new RegExp(`<${elementName}\\b[^>]*>[\\s\\S]*?</${elementName}>`, 'g');
  return [...xml.matchAll(actionPattern)].some((actionMatch) => {
    const actionXml = actionMatch[0];
    const openingTag = actionXml.match(new RegExp(`^<${elementName}\\b[^>]*>`))?.[0];
    if (openingTag === undefined || unescapeXml(getAttr(openingTag, 'caption') ?? '') !== caption) {
      return false;
    }
    return [...actionXml.matchAll(/<param\b[^>]*>/g)].some(
      (paramMatch) =>
        getAttr(paramMatch[0], 'name') === paramName &&
        unescapeXml(getAttr(paramMatch[0], 'value') ?? '') === target,
    );
  });
}

function nextActionName(xml: string): string {
  const used = new Set(
    [...xml.matchAll(/\bname=(['"])\[Action(\d+)[^\]]*\]\1/g)].map((match) => Number(match[2])),
  );
  let n = 1;
  while (used.has(n)) {
    n += 1;
  }
  return `[Action${n}]`;
}

function renderParameterAction({
  caption,
  actionName,
  sourceWorksheet,
  sourceField,
  targetParameter,
  activation,
}: {
  caption: string;
  actionName: string;
  sourceWorksheet: string;
  sourceField: string;
  targetParameter: string;
  activation: z.infer<typeof activationSchema>;
}): string {
  const params: string[] = [];
  if (sourceField.trim().length > 0) {
    params.push(`<param name='source-field' value='${escapeXml(sourceField.trim())}' />`);
  }
  params.push(`<param name='target-parameter' value='${escapeXml(targetParameter.trim())}' />`);
  return (
    `<edit-parameter-action caption='${escapeXml(caption)}' name='${escapeXml(actionName)}'>` +
    `<activation type='${activation}' />` +
    `<source type='sheet' worksheet='${escapeXml(sourceWorksheet.trim())}' />` +
    "<agg-type type='attr' />" +
    "<clear-option type='do-nothing' value='s:LROOT:' />" +
    `<params>${params.join('')}</params>` +
    '</edit-parameter-action>'
  );
}

function resolveTargetSet(
  liveXml: string,
  targetSet: string | undefined,
  datasource?: string,
): Result<string, ArgsValidationError> {
  const datasourceElements = findDatasourceElements(liveXml);
  const allCandidates = datasourceElements.flatMap((element) =>
    findGroupTags(element.xml).flatMap((tag): SetCandidate[] => {
      const name = getAttr(tag, 'name');
      if (name === undefined) {
        return [];
      }
      const caption = getAttr(tag, 'caption');
      return [
        {
          datasourceName: element.name,
          datasourceCaption: element.caption,
          name: unescapeXml(name),
          caption: caption === undefined ? undefined : unescapeXml(caption),
        },
      ];
    }),
  );
  const matchedDatasourceElements =
    datasource === undefined
      ? datasourceElements
      : datasourceElements.filter(
          (element) => element.name === datasource || element.caption === datasource,
        );
  if (datasource !== undefined && matchedDatasourceElements.length === 0) {
    return new ArgsValidationError(
      `datasource '${datasource}' matched no datasource; sets found in: ${formatSetCandidates(allCandidates)}`,
    ).toErr();
  }
  const matchedDatasourceNames = new Set(matchedDatasourceElements.map((element) => element.name));
  const candidates = allCandidates.filter((candidate) =>
    matchedDatasourceNames.has(candidate.datasourceName),
  );
  const available = formatSetCandidates(candidates);

  if (targetSet === undefined || targetSet.trim().length === 0) {
    return new ArgsValidationError(
      `targetSet is required in set mode. Available sets: ${available}`,
    ).toErr();
  }

  const requested = normalizeReferenceToken(targetSet);
  const matches = candidates.filter(
    (candidate) =>
      normalizeReferenceToken(candidate.name) === requested ||
      (candidate.caption !== undefined && normalizeReferenceToken(candidate.caption) === requested),
  );
  if (matches.length === 0) {
    return new ArgsValidationError(
      `Set "${targetSet}" was not found. Available sets: ${available}`,
    ).toErr();
  }
  if (matches.length > 1) {
    return new ArgsValidationError(
      `Set "${targetSet}" is ambiguous; specify datasource. Matches: ${formatSetCandidates(matches)}`,
    ).toErr();
  }

  const match = matches[0];
  return new Ok(`${bracketToken(match.datasourceName)}.${bracketToken(match.name)}`);
}

function findDatasourceElements(xml: string): DatasourceElement[] {
  const elements: DatasourceElement[] = [];
  const blockStart = xml.indexOf('<datasources>');
  const blockEnd = xml.indexOf('</datasources>', blockStart);
  const scanFrom = blockStart === -1 ? 0 : blockStart;
  const scanTo = blockEnd === -1 ? xml.length : blockEnd;
  for (const match of xml.matchAll(/<datasource(?=\s)[^>]*\bname=(?:'[^']*'|"[^"]*")[^>]*>/g)) {
    if (match.index < scanFrom || match.index >= scanTo || /\/\s*>$/.test(match[0])) {
      continue;
    }
    const name = getAttr(match[0], 'name');
    if (name === undefined) {
      continue;
    }
    const openEnd = match.index + match[0].length;
    const closeStart = xml.indexOf('</datasource>', openEnd);
    if (closeStart === -1 || closeStart > scanTo) {
      continue;
    }
    const caption = getAttr(match[0], 'caption');
    elements.push({
      name: unescapeXml(name),
      caption: caption === undefined ? undefined : unescapeXml(caption),
      xml: xml.slice(match.index, closeStart + '</datasource>'.length),
    });
  }
  return elements;
}

function findGroupTags(xml: string): string[] {
  return [...xml.matchAll(/<group\b[^>]*>/g)]
    .map((match) => match[0])
    .filter((tag) => getAttr(tag, 'user:ui-builder') === 'filter-group');
}

function normalizeReferenceToken(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed;
}

function bracketToken(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed : `[${trimmed}]`;
}

function formatSetCandidates(candidates: SetCandidate[]): string {
  if (candidates.length === 0) {
    return 'none';
  }
  return candidates
    .map(
      (candidate) =>
        `${candidate.caption ?? candidate.name} (${candidate.name}, datasource ${candidate.datasourceCaption ?? candidate.datasourceName})`,
    )
    .join(', ');
}

function renderSetAction({
  caption,
  actionName,
  sourceWorksheet,
  targetSet,
  setMembership,
  clearSelection,
  singleSelect,
  activation,
}: {
  caption: string;
  actionName: string;
  sourceWorksheet: string;
  targetSet: string;
  setMembership: z.infer<typeof setMembershipSchema>;
  clearSelection: z.infer<typeof clearSelectionSchema>;
  singleSelect: boolean | undefined;
  activation: z.infer<typeof activationSchema>;
}): string {
  const singleSelectXml =
    singleSelect === undefined ? '' : `<single-select value='${singleSelect}' />`;
  return (
    `<edit-group-action caption='${escapeXml(caption)}' name='${escapeXml(actionName)}'>` +
    `<activation type='${activation}' />` +
    `<source type='sheet' worksheet='${escapeXml(sourceWorksheet.trim())}' />` +
    singleSelectXml +
    `<add-or-remove-marks value='${setMembership}' />` +
    `<params><param name='selection-clear-set-option' value='${clearSelection}' />` +
    `<param name='target-group' value='${escapeXml(targetSet)}' /></params>` +
    '</edit-group-action>'
  );
}

// Splice a single action into the workbook-level <actions> block, creating the block
// between </datasources> and <worksheets> if it does not yet exist. PROVEN live:
// this is where Tableau expects workbook-scoped actions and where a merge takes.
function spliceActionIntoWorkbook(
  xml: string,
  actionXml: string,
): Result<string, XmlModificationError> {
  const actionsOpen = xml.indexOf('<actions>');
  if (actionsOpen !== -1) {
    const actionsClose = xml.indexOf('</actions>', actionsOpen);
    if (actionsClose === -1) {
      return new XmlModificationError('malformed document: <actions> without </actions>').toErr();
    }
    return new Ok(`${xml.slice(0, actionsClose)}${actionXml}${xml.slice(actionsClose)}`);
  }

  const dsClose = xml.indexOf('</datasources>');
  if (dsClose === -1) {
    return new XmlModificationError(
      'cannot place actions: no </datasources> anchor in document',
    ).toErr();
  }
  const insertAt = dsClose + '</datasources>'.length;
  return new Ok(`${xml.slice(0, insertAt)}<actions>${actionXml}</actions>${xml.slice(insertAt)}`);
}

function getAttr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}=(['"])(.*?)\\1`));
  return match?.[2];
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll("'", '&apos;')
    .replaceAll('"', '&quot;');
}

function unescapeXml(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');
}
