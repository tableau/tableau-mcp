import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { validateWorkbookDocumentApply } from '../../../../desktop/guards/workbookDocumentGuard.js';
import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import { getWorkbookXml } from '../../../../desktop/wrappers/getWorkbookXml.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  XmlModificationError,
} from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { sessionParam } from '../../params.js';
import { DesktopTool } from '../../tool.js';
import { applyAndVerify } from './applyAndVerify.js';

const activationSchema = z.enum(['on-select', 'on-hover', 'on-menu']);
const modeSchema = z.enum(['parameter', 'set', 'url']);
const setMembershipSchema = z.enum(['assign', 'add', 'remove']);
const clearSelectionSchema = z.enum(['do-nothing', 'show-all', 'exclude-all']);
const urlTargetSchema = z.enum(['default-zone-or-browser', 'browser', 'specific-zone']);

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
  url: z
    .string()
    .optional()
    .describe(
      'URL for url mode. Pass it raw and unescaped (the tool escapes it). Use <[Field Name]> to insert a field value.',
    ),
  sourceDashboard: z.string().optional().describe(''),
  excludeSheets: z.array(z.string()).optional().describe(''),
  urlTarget: urlTargetSchema.optional().describe(''),
  zoneId: z.string().optional().describe(''),
  urlEncode: z.boolean().optional().describe(''),
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
    | {
        mode: 'url';
        url: string;
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
        url,
        sourceDashboard,
        excludeSheets,
        urlTarget,
        zoneId,
        urlEncode,
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
          url,
          sourceDashboard,
          excludeSheets,
          urlTarget,
          zoneId,
          urlEncode,
        },
        callback: async () => {
          if (caption.trim().length === 0) {
            return new ArgsValidationError('caption empty').toErr();
          }
          if (mode !== 'url' && sourceWorksheet.trim().length === 0) {
            return new ArgsValidationError('sourceWorksheet empty').toErr();
          }
          if (mode === 'url') {
            if (url === undefined || url.trim().length === 0) {
              return new ArgsValidationError('url is required in url mode').toErr();
            }
            if (/^tsl:/i.test(url.trim())) {
              return new ArgsValidationError(
                "url must not start with 'tsl:' — that prefix classifies the action as a sheet-link filter, not a URL action",
              ).toErr();
            }
            // The url is XML-escaped once on the way out. A pre-escaped input (&lt;, &amp;,
            // …) would be escaped again into &amp;lt; and render as a literal string, so the
            // field reference silently dies. Reject it and tell the caller to pass raw chars.
            if (/&(?:lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/.test(url)) {
              return new ArgsValidationError(
                'url must be passed unescaped: it contains an XML entity such as &lt; or &amp;. Use literal characters — for field substitution write <[Field Name]>, e.g. https://www.google.com/search?q=<[City]>.',
              ).toErr();
            }
            if ((targetParameter?.trim().length ?? 0) > 0 || (targetSet?.trim().length ?? 0) > 0) {
              return new ArgsValidationError(
                'targetParameter/targetSet are not allowed in url mode',
              ).toErr();
            }
            const hasWorksheet = sourceWorksheet.trim().length > 0;
            const hasDashboard = (sourceDashboard?.trim().length ?? 0) > 0;
            if (!hasWorksheet && !hasDashboard) {
              return new ArgsValidationError(
                'url mode requires a source: set sourceWorksheet, sourceDashboard, or both',
              ).toErr();
            }
            if ((excludeSheets?.length ?? 0) > 0 && (hasWorksheet || !hasDashboard)) {
              return new ArgsValidationError(
                'excludeSheets is only allowed with a dashboard-only source (set sourceDashboard, leave sourceWorksheet empty)',
              ).toErr();
            }
            if (urlTarget === 'specific-zone') {
              const trimmedZoneId = zoneId?.trim() ?? '';
              if (trimmedZoneId.length === 0) {
                return new ArgsValidationError(
                  'zoneId is required when urlTarget is specific-zone',
                ).toErr();
              }
              // Tableau parses <url-action-target> as an integer and treats zone 0 as
              // "no specific zone", so a non-numeric or zero zoneId would silently
              // degrade to the default target while readback still reports success.
              // Reject anything but a positive integer up front.
              if (!/^[1-9][0-9]*$/.test(trimmedZoneId)) {
                return new ArgsValidationError('zoneId must be a positive integer zone id').toErr();
              }
            }
            if (urlTarget !== 'specific-zone' && (zoneId?.trim().length ?? 0) > 0) {
              return new ArgsValidationError(
                'zoneId is only allowed when urlTarget is specific-zone',
              ).toErr();
            }
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
          if (mode === 'url') {
            // Sheet names share one namespace across worksheets/dashboards/stories, so a
            // source name is unambiguously one kind. A dashboard name slotted into
            // sourceWorksheet emits <source worksheet='<dashboard>'>, which Tableau resolves
            // through GetWorksheet -> AsWorksheet() on a dashboard doc and throws 0x5CCCC2BD
            // ("incorrectly expecting worksheet") when the action is later opened/edited.
            // Reject the miscategorized source before it can persist, and steer the caller to
            // the correct slot.
            const worksheetNames = findSheetNames(liveXml, 'worksheets', 'worksheet');
            const dashboardNames = findSheetNames(liveXml, 'dashboards', 'dashboard');
            const trimmedWorksheet = sourceWorksheet.trim();
            const trimmedDashboard = sourceDashboard?.trim() ?? '';
            if (trimmedWorksheet.length > 0 && dashboardNames.has(trimmedWorksheet)) {
              return new ArgsValidationError(
                `'${trimmedWorksheet}' is a dashboard, not a worksheet. Pass it as sourceDashboard and leave sourceWorksheet empty (or set sourceWorksheet to a worksheet inside the dashboard) so the URL action is scoped to the dashboard.`,
              ).toErr();
            }
            if (trimmedDashboard.length > 0 && worksheetNames.has(trimmedDashboard)) {
              return new ArgsValidationError(
                `'${trimmedDashboard}' is a worksheet, not a dashboard. Pass it as sourceWorksheet instead.`,
              ).toErr();
            }
          }
          if (
            mode === 'url' &&
            hasUrlActionDuplicate(
              liveXml,
              url!.trim(),
              sourceWorksheet.trim(),
              sourceDashboard?.trim() ?? '',
            )
          ) {
            return new ArgsValidationError(
              'an identical URL action (same url and same source) already exists',
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
          } else if (mode === 'url') {
            target = url!.trim();
            actionXml = renderUrlAction({
              caption,
              actionName,
              sourceWorksheet: sourceWorksheet.trim(),
              sourceDashboard: sourceDashboard?.trim() ?? '',
              excludeSheets: (excludeSheets ?? []).map((sheet) => sheet.trim()),
              url: target,
              urlTarget: urlTarget ?? 'default-zone-or-browser',
              zoneId: zoneId?.trim() ?? '',
              urlEncode: urlEncode ?? false,
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

          const targetParamLanded = (xml: string): boolean => {
            if (mode === 'set') {
              return hasActionWithTargetParam(
                xml,
                'edit-group-action',
                caption,
                'target-group',
                target,
              );
            }
            if (mode === 'url') {
              return hasUrlActionWithLink(xml, caption, target);
            }
            return hasActionWithTargetParam(
              xml,
              'edit-parameter-action',
              caption,
              'target-parameter',
              target,
            );
          };
          const outcome = await applyAndVerify({
            xml: editedXml,
            baselineXml: liveXml,
            settled: targetParamLanded,
            executor,
            signal: extra.signal,
          });
          if (outcome.status === 'failed') {
            return outcome.error.toErr();
          }
          if (outcome.status === 'not-applied') {
            return new XmlModificationError(
              mode === 'set'
                ? 'action applied but the target-group param did not survive readback'
                : mode === 'url'
                  ? 'action applied but the <link> URL did not survive readback (it may have been dropped or rewritten as a command action)'
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
          if (mode === 'url') {
            return new Ok({
              actionName,
              caption,
              mode,
              target,
              url: target,
              hint: 'readback verified the <link> URL action; the source sheet/dashboard must expose marks that drive the action, and any <[Field]> references must resolve on the source view',
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

// Collect the declared sheet names inside a top-level container (<worksheets> or
// <dashboards>). The (?=\s) lookahead keeps the plural container tag itself from
// matching, and scanning only within the block avoids picking up sheet references
// nested elsewhere in the document.
function findSheetNames(xml: string, blockTag: string, elementTag: string): Set<string> {
  const names = new Set<string>();
  const blockStart = xml.indexOf(`<${blockTag}>`);
  if (blockStart === -1) {
    return names;
  }
  const blockEnd = xml.indexOf(`</${blockTag}>`, blockStart);
  const block = xml.slice(blockStart, blockEnd === -1 ? xml.length : blockEnd);
  const pattern = new RegExp(`<${elementTag}(?=\\s)[^>]*\\bname=(?:'[^']*'|"[^"]*")[^>]*>`, 'g');
  for (const match of block.matchAll(pattern)) {
    const name = getAttr(match[0], 'name');
    if (name !== undefined) {
      names.add(unescapeXml(name));
    }
  }
  return names;
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

// A URL action is the legacy <action> tag whose payload is a <link> (NOT a
// <command>): monolith GetActionType classifies it URL(3) iff IsLink() is true and
// the expression is not tsl:-prefixed. The URL lives in link@expression; an
// expression attr on <action> itself makes the parser drop the action. The single
// <source> carries independently-optional worksheet/dashboard attrs (worksheet-only,
// dashboard-only + <exclude-sheet> opt-outs, or a worksheet scoped within a dashboard).
function renderUrlAction({
  caption,
  actionName,
  sourceWorksheet,
  sourceDashboard,
  excludeSheets,
  url,
  urlTarget,
  zoneId,
  urlEncode,
  activation,
}: {
  caption: string;
  actionName: string;
  sourceWorksheet: string;
  sourceDashboard: string;
  excludeSheets: string[];
  url: string;
  urlTarget: z.infer<typeof urlTargetSchema>;
  zoneId: string;
  urlEncode: boolean;
  activation: z.infer<typeof activationSchema>;
}): string {
  const sourceAttrs =
    (sourceWorksheet.length > 0 ? ` worksheet='${escapeXml(sourceWorksheet)}'` : '') +
    (sourceDashboard.length > 0 ? ` dashboard='${escapeXml(sourceDashboard)}'` : '');
  const excludeChildren = excludeSheets
    .filter((sheet) => sheet.length > 0)
    .map((sheet) => `<exclude-sheet name='${escapeXml(sheet)}' />`)
    .join('');
  const sourceXml =
    excludeChildren.length > 0
      ? `<source type='sheet'${sourceAttrs}>${excludeChildren}</source>`
      : `<source type='sheet'${sourceAttrs} />`;

  const urlEscapeAttr = urlEncode ? " url-escape='true'" : '';
  const linkChildren =
    urlTarget === 'browser'
      ? '<url-action-type>browser</url-action-type>'
      : urlTarget === 'specific-zone'
        ? `<url-action-type>specific-zone</url-action-type><url-action-target>${escapeXml(zoneId)}</url-action-target>`
        : '';
  const linkXml =
    linkChildren.length > 0
      ? `<link caption='' expression='${escapeXml(url)}'${urlEscapeAttr}>${linkChildren}</link>`
      : `<link caption='' expression='${escapeXml(url)}'${urlEscapeAttr} />`;

  return (
    `<action caption='${escapeXml(caption)}' name='${escapeXml(actionName)}'>` +
    `<activation type='${activation}' />` +
    sourceXml +
    linkXml +
    '</action>'
  );
}

// Readback predicate for url mode: the caption-matched legacy <action> must carry a
// <link> whose expression survived AND must have NO <command> child (a <command>
// payload is exactly the type-0 shape the agent used to hand-author, which classifies
// as Unknown(0) rather than URL(3)).
function hasUrlActionWithLink(xml: string, caption: string, expression: string): boolean {
  return [...xml.matchAll(/<action\b[^>]*>[\s\S]*?<\/action>/g)].some((match) => {
    const block = match[0];
    const openingTag = block.match(/^<action\b[^>]*>/)?.[0];
    if (openingTag === undefined || unescapeXml(getAttr(openingTag, 'caption') ?? '') !== caption) {
      return false;
    }
    if (/<command\b/.test(block)) {
      return false;
    }
    const linkTag = block.match(/<link\b[^>]*>/)?.[0];
    if (linkTag === undefined) {
      return false;
    }
    const linkExpression = getAttr(linkTag, 'expression');
    if (linkExpression === undefined) {
      return false;
    }
    // A double-escaped expression (e.g. &amp;lt;[City]&amp;gt;) means a field reference
    // degraded into a literal string. It still round-trips through unescapeXml back to the
    // caller's input, so the equality check below would falsely report success. Reject the
    // double-escape signature here so a broken URL action surfaces as not-applied.
    if (/&amp;(?:lt|gt|amp|quot|apos);/.test(linkExpression)) {
      return false;
    }
    return unescapeXml(linkExpression) === expression;
  });
}

// Dedup guard: the document-apply path appends, so a same-url + same-source action
// authored under a different caption would silently double. Caption collision is
// handled separately by hasActionCaption.
function hasUrlActionDuplicate(
  xml: string,
  expression: string,
  sourceWorksheet: string,
  sourceDashboard: string,
): boolean {
  return [...xml.matchAll(/<action\b[^>]*>[\s\S]*?<\/action>/g)].some((match) => {
    const block = match[0];
    const linkTag = block.match(/<link\b[^>]*>/)?.[0];
    if (linkTag === undefined) {
      return false;
    }
    const linkExpression = getAttr(linkTag, 'expression');
    if (linkExpression === undefined || unescapeXml(linkExpression) !== expression) {
      return false;
    }
    const sourceTag = block.match(/<source\b[^>]*>/)?.[0];
    const existingWorksheet =
      sourceTag === undefined ? '' : unescapeXml(getAttr(sourceTag, 'worksheet') ?? '');
    const existingDashboard =
      sourceTag === undefined ? '' : unescapeXml(getAttr(sourceTag, 'dashboard') ?? '');
    return existingWorksheet === sourceWorksheet && existingDashboard === sourceDashboard;
  });
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
