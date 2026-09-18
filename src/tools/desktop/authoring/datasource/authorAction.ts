import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { bareName, summarizeSchema } from '../../../../desktop/binder/schema-summary.js';
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
import {
  DatasourceElement,
  findDatasourceElements,
  selectTargetDatasource,
} from './authorCalcCore.js';

const activationSchema = z.enum(['on-select', 'on-hover', 'on-menu']);
const modeSchema = z.enum(['parameter', 'set', 'url', 'filter']);
const setMembershipSchema = z.enum(['assign', 'add', 'remove']);
const clearSelectionSchema = z.enum(['do-nothing', 'show-all', 'exclude-all']);
const urlTargetSchema = z.enum(['default-zone-or-browser', 'browser', 'specific-zone']);

// Primitives in, action XML server-side, readback out. An action wires a mark
// interaction on a source sheet to a target parameter, set, URL, or filter.
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
  targetSheet: z.string().optional().describe(''),
  filterFields: z.array(z.string()).optional().describe(''),
  datasource: z.string().optional().describe('Internal datasource name or unique caption.'),
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
    | {
        mode: 'filter';
        targetSheet: string;
        sourceWorksheet: string;
        sourceDashboard: string;
        // Key settings echoed back: activation (on-select/on-hover/on-menu),
        // clearing behavior (do-nothing/show-all/exclude-all), and the single-select-only toggle.
        activation: z.infer<typeof activationSchema>;
        clearSelection: z.infer<typeof clearSelectionSchema>;
        singleSelect: boolean;
        specificFields: { datasourceName: string | undefined; columnNames: string[] };
        excludeSheets: string[];
      }
  );

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
    description: 'Add action.',
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
        targetSheet,
        filterFields,
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
          targetSheet,
          filterFields,
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
          const effectiveSourceSheet = sourceWorksheet.trim();
          const effectiveSourceDashboard = sourceDashboard?.trim() ?? '';
          const hasWorksheet = effectiveSourceSheet.length > 0;
          const hasDashboard = effectiveSourceDashboard.length > 0;
          const effectiveTargetSheet = targetSheet?.trim() ?? '';
          const effectiveExcludedSheets = (excludeSheets ?? [])
            .map((sheet) => sheet.trim())
            .filter((sheet) => sheet.length > 0);

          if (caption.trim().length === 0) {
            return new ArgsValidationError('caption empty').toErr();
          }
          if (mode !== 'url' && mode !== 'filter' && effectiveSourceSheet.length === 0) {
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
          if (mode === 'filter') {
            if ((targetParameter?.trim().length ?? 0) > 0 || (targetSet?.trim().length ?? 0) > 0) {
              return new ArgsValidationError(
                'targetParameter/targetSet are not allowed in filter mode; use targetSheet',
              ).toErr();
            }
            if ((url?.trim().length ?? 0) > 0) {
              return new ArgsValidationError('url is not allowed in filter mode').toErr();
            }
            if (targetSheet === undefined || targetSheet.trim().length === 0) {
              return new ArgsValidationError('targetSheet is required in filter mode').toErr();
            }
            if (!hasWorksheet && !hasDashboard) {
              return new ArgsValidationError(
                'filter mode requires a source: set sourceWorksheet, sourceDashboard, or both',
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

          const worksheetNames = findSheetNames(liveXml, 'worksheets', 'worksheet');
          const dashboardNames = findSheetNames(liveXml, 'dashboards', 'dashboard');
          if (mode === 'url' || mode === 'filter') {
            // Worksheet, dashboard, and story names share one namespace, so a source name
            // is unambiguously one kind. Emitting <source worksheet='<dashboard>'> (a
            // dashboard name in the worksheet slot) persists cleanly but makes Tableau raise
            // an internal error when the action is later opened for editing, because it then
            // resolves that name as a worksheet and finds a dashboard instead. Reject the
            // miscategorized source up front and steer the caller to the correct slot.
            if (effectiveSourceSheet.length > 0 && dashboardNames.has(effectiveSourceSheet)) {
              return new ArgsValidationError(
                `'${effectiveSourceSheet}' is a dashboard, not a worksheet. Pass it as sourceDashboard and leave sourceWorksheet empty (or set sourceWorksheet to a worksheet inside the dashboard) so the action is scoped to the dashboard.`,
              ).toErr();
            }
            if (
              effectiveSourceDashboard.length > 0 &&
              worksheetNames.has(effectiveSourceDashboard)
            ) {
              return new ArgsValidationError(
                `'${effectiveSourceDashboard}' is a worksheet, not a dashboard. Pass it as sourceWorksheet instead.`,
              ).toErr();
            }
          }
          if (mode === 'filter') {
            // A filter action's source and target must both be real sheets/dashboards. A target that is not a
            // real sheet or dashboard silently filters nothing, so reject a typo up front.
            if (effectiveSourceSheet.length > 0 && !worksheetNames.has(effectiveSourceSheet)) {
              return new ArgsValidationError(
                `sourceWorksheet "${effectiveSourceSheet}" was not found. Available worksheets: ${worksheetNames.size > 0 ? [...worksheetNames].join(', ') : 'none'}`,
              ).toErr();
            }
            if (
              effectiveSourceDashboard.length > 0 &&
              !dashboardNames.has(effectiveSourceDashboard)
            ) {
              return new ArgsValidationError(
                `sourceDashboard "${effectiveSourceDashboard}" was not found. Available dashboards: ${dashboardNames.size > 0 ? [...dashboardNames].join(', ') : 'none'}`,
              ).toErr();
            }
            const trimmedTarget = targetSheet!.trim();
            if (!worksheetNames.has(trimmedTarget) && !dashboardNames.has(trimmedTarget)) {
              const available = [...worksheetNames, ...dashboardNames];
              return new ArgsValidationError(
                `targetSheet "${trimmedTarget}" was not found. Available sheets: ${available.length > 0 ? available.join(', ') : 'none'}`,
              ).toErr();
            }
          }

          let filterDependencies:
            | { datasourceName: string; datasourceXml: string; columnsXml: string[] }
            | undefined;
          let targetDatasource: DatasourceElement | undefined;
          let resolvedFields: ResolvedFilterField[] | undefined;
          let filterLinkExpression: string | undefined;
          if (mode === 'filter' && (filterFields ?? []).some((field) => field.trim().length > 0)) {
            const datasourceResult = selectTargetDatasource(liveXml, datasource);
            if (datasourceResult.isErr()) {
              return datasourceResult.error.toErr();
            }
            targetDatasource = datasourceResult.value;
            const fieldsResult = resolveFilterFields(
              liveXml,
              targetDatasource.name,
              filterFields ?? [],
            );
            if (fieldsResult.isErr()) {
              return fieldsResult.error.toErr();
            }
            resolvedFields = fieldsResult.value;
            filterLinkExpression = buildTslExpression(
              effectiveTargetSheet,
              targetDatasource.name,
              resolvedFields.map((field) => field.columnName),
            );
            filterDependencies = {
              datasourceName: targetDatasource.name,
              datasourceXml: renderActionDatasource(targetDatasource),
              columnsXml: resolvedFields.map((field) => renderDependencyColumn(field)),
            };
          }

          if (
            mode === 'url' &&
            hasUrlActionDuplicate(
              liveXml,
              url!.trim(),
              effectiveSourceSheet,
              effectiveSourceDashboard,
            )
          ) {
            return new ArgsValidationError(
              'an identical URL action (same url and same source) already exists',
            ).toErr();
          }
          if (
            mode === 'filter' &&
            hasFilterActionDuplicate(
              liveXml,
              effectiveTargetSheet,
              effectiveSourceSheet,
              effectiveSourceDashboard,
              filterLinkExpression,
            )
          ) {
            return new ArgsValidationError(
              'an identical filter action (same source, target, and fields) already exists',
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
              sourceWorksheet: effectiveSourceSheet,
              sourceDashboard: effectiveSourceDashboard,
              excludeSheets: (excludeSheets ?? []).map((sheet) => sheet.trim()),
              url: target,
              urlTarget: urlTarget ?? 'default-zone-or-browser',
              zoneId: zoneId?.trim() ?? '',
              urlEncode: urlEncode ?? false,
              activation,
            });
          } else if (mode === 'filter') {
            target = effectiveTargetSheet;
            actionXml = renderFilterAction({
              caption,
              actionName,
              sourceWorksheet: effectiveSourceSheet,
              sourceDashboard: effectiveSourceDashboard,
              target: target,
              targetDatasource,
              resolvedFields,
              excludeSheets: effectiveExcludedSheets,
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
          const editResult = spliceActionIntoWorkbook(liveXml, actionXml, filterDependencies);
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
            if (mode === 'filter') {
              return hasFilterActionWithTarget(xml, caption, target, filterLinkExpression);
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
                  : mode === 'filter'
                    ? 'action applied but the tsl-filter target did not survive readback (it may have been dropped or rewritten as a different action type)'
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
          if (mode === 'filter') {
            const hint = `readback verified the tsl-filter action targeting '${target}'; source scoped to ${[
              hasWorksheet ? `worksheet '${effectiveSourceSheet}'` : '',
              hasDashboard ? `dashboard '${effectiveSourceDashboard}'` : '',
            ]
              .filter(Boolean)
              .join(
                ' on ',
              )}; Tableau generates the sheet_link group column on the target datasource(s) when the action runs, and the source view must expose marks that drive the filter`;
            return new Ok({
              actionName,
              caption,
              mode,
              sourceWorksheet: effectiveSourceSheet,
              sourceDashboard: effectiveSourceDashboard,
              target: target,
              targetSheet: target,
              specificFields: {
                datasourceName: targetDatasource?.name,
                columnNames: resolvedFields?.map((field) => field.columnName) ?? [],
              },
              excludeSheets: effectiveExcludedSheets,
              clearSelection,
              singleSelect: singleSelect === true,
              activation,
              hint,
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

// Emit <source> attributes type-first (type, worksheet, dashboard). Attribute order is not
// semantically meaningful and Tableau re-normalizes it on save, so we keep the shared order the
// URL-action tests already pin rather than sorting.
function renderSourceAttrs(sourceWorksheet: string, sourceDashboard: string): string {
  return (
    " type='sheet'" +
    (sourceWorksheet.length > 0 ? ` worksheet='${escapeXml(sourceWorksheet)}'` : '') +
    (sourceDashboard.length > 0 ? ` dashboard='${escapeXml(sourceDashboard)}'` : '')
  );
}

// Serializes the <activation> element uniformly for every action type:
// click ('on-select') and hover ('on-hover') write a type attribute; the tooltip-menu trigger
// ('on-menu') writes none. auto-clear (the filter clear-on-empty flag) is written when set.
function renderActivation(activation: z.infer<typeof activationSchema>, autoClear = false): string {
  const autoClearAttr = autoClear ? " auto-clear='true'" : '';
  const typeAttr = activation === 'on-menu' ? '' : ` type='${activation}'`;
  return `<activation${autoClearAttr}${typeAttr} />`;
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
    renderActivation(activation) +
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
  let matchedDatasourceElements = datasourceElements;
  if (datasource !== undefined) {
    const selectedDatasource = selectTargetDatasource(liveXml, datasource);
    if (selectedDatasource.isErr()) return selectedDatasource;
    matchedDatasourceElements = [selectedDatasource.value];
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
    renderActivation(activation) +
    `<source type='sheet' worksheet='${escapeXml(sourceWorksheet.trim())}' />` +
    singleSelectXml +
    `<add-or-remove-marks value='${setMembership}' />` +
    `<params><param name='selection-clear-set-option' value='${clearSelection}' />` +
    `<param name='target-group' value='${escapeXml(targetSet)}' /></params>` +
    '</edit-group-action>'
  );
}

// A URL action is the legacy <action> tag whose payload is a <link> child (never a
// <command>). Tableau treats the action as a URL action only when a <link> is present
// and its expression is not tsl:-prefixed; a <command> payload is read as a different,
// non-URL action type and does nothing. The URL lives in the <link> expression attribute
// only — an expression attribute on <action> itself makes Tableau drop the action on
// parse. The single <source> carries independently-optional worksheet/dashboard attrs
// (worksheet-only, dashboard-only + <exclude-sheet> opt-outs, or a worksheet scoped
// within a dashboard).
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
  const sourceAttrs = renderSourceAttrs(sourceWorksheet, sourceDashboard);
  const excludeChildren = excludeSheets
    .filter((sheet) => sheet.length > 0)
    .map((sheet) => `<exclude-sheet name='${escapeXml(sheet)}' />`)
    .join('');
  const sourceXml =
    excludeChildren.length > 0
      ? `<source${sourceAttrs}>${excludeChildren}</source>`
      : `<source${sourceAttrs} />`;

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
    renderActivation(activation) +
    sourceXml +
    linkXml +
    '</action>'
  );
}

type ResolvedFilterField = {
  columnName: string; // bracketed internal name, e.g. "[Category]"
  datatype: string;
  role: string;
  type: string;
};

// Resolve caller-named filter fields (captions, friendly names, or bracketed names) to their
// internal column name and datatype/role/type via the shared schema source (summarizeSchema).
// A missing field is a blocker that lists the available fields, never a silent all-fields fallback.
function resolveFilterFields(
  liveXml: string,
  datasourceName: string,
  requested: string[],
): Result<ResolvedFilterField[], ArgsValidationError> {
  const fields = summarizeSchema(liveXml).fields.filter(
    (field) => field.datasource === datasourceName,
  );
  const available =
    fields.length > 0
      ? [...new Set(fields.map((field) => field.caption ?? bareName(field.columnName)))].join(', ')
      : 'none';
  const resolved: ResolvedFilterField[] = [];
  for (const raw of requested) {
    const token = normalizeReferenceToken(raw).normalize('NFC');
    // Ignore empty/whitespace-only entries so a raw, untrimmed field list resolves cleanly.
    if (token.length === 0) {
      continue;
    }
    const match = fields.find(
      (field) =>
        field.name.normalize('NFC') === token ||
        (field.caption !== undefined && field.caption.normalize('NFC') === token) ||
        bareName(field.columnName).normalize('NFC') === token,
    );
    if (match === undefined) {
      return new ArgsValidationError(
        `Filter field "${raw}" was not found in datasource ${datasourceName}. Available fields: ${available}`,
      ).toErr();
    }
    resolved.push({
      columnName: match.columnName,
      datatype: match.datatype,
      role: match.role,
      type: match.type,
    });
  }
  return new Ok(resolved);
}

// Build the raw tsl: sheet-link expression for a specific-field filter. Each field adds a clause
// `<urlenc([ds].[field])>~s0=<[ds].[field]~na>` (locator URL-encoded on the left, raw in the <…~na>
// token on the right), joined with '&'; the caller XML-escapes the result into <link expression>.
function buildTslExpression(target: string, datasourceName: string, columnNames: string[]): string {
  const clauses = columnNames.map((columnName) => {
    const locator = `[${datasourceName}].${columnName}`;
    return `${encodeURIComponent(locator)}~s0=<${locator}~na>`;
  });
  return `tsl:${encodeURIComponent(target)}?${clauses.join('&')}`;
}

function renderActionDatasource(datasourceElement: DatasourceElement): string {
  const captionAttr =
    datasourceElement.caption !== undefined
      ? `caption='${escapeXml(datasourceElement.caption)}' `
      : '';
  return `<datasource ${captionAttr}name='${escapeXml(datasourceElement.name)}' />`;
}

function renderDependencyColumn(field: ResolvedFilterField): string {
  return (
    `<column datatype='${escapeXml(field.datatype)}' name='${escapeXml(field.columnName)}' ` +
    `role='${escapeXml(field.role)}' type='${escapeXml(field.type)}' />`
  );
}

// A filter action is the legacy <action> tag with a <command command='tsc:tsl-filter'> payload;
// the source's selected marks filter the target. We only author the <action> — Tableau backfills
// the "sheet_link" <group> column on the target datasource at run time.
// Fields come in two shapes (both confirmed against field-observed XML):
//   All Fields (filterFields undefined) -> a lone <command> with special-fields='all'.
//   Specific fields (filterFields defined) -> a tsl: <link> of field locators plus a <command> keeping only the target
//     param, with the fields declared in sibling <datasources>/<datasource-dependencies> blocks
//     (see spliceActionIntoWorkbook's deps handling).
function renderFilterAction({
  caption,
  actionName,
  sourceWorksheet,
  sourceDashboard,
  target,
  targetDatasource,
  resolvedFields,
  excludeSheets,
  clearSelection,
  singleSelect,
  activation,
}: {
  caption: string;
  actionName: string;
  sourceWorksheet: string;
  sourceDashboard: string;
  target: string;
  targetDatasource?: DatasourceElement;
  resolvedFields?: ResolvedFilterField[];
  excludeSheets: string[];
  clearSelection: z.infer<typeof clearSelectionSchema>;
  singleSelect: boolean | undefined;
  activation: z.infer<typeof activationSchema>;
}): string {
  const activationXml = renderActivation(activation, clearSelection !== 'do-nothing');

  const sourceXml = `<source${renderSourceAttrs(sourceWorksheet, sourceDashboard)} />`;

  // The caller resolves the named fields (and only when at least one non-empty field was
  // requested), so their presence is what marks a specific-field filter; otherwise All Fields.
  const isSpecificFilter = (resolvedFields?.length ?? 0) > 0;

  // A specific-field filter carries its fields in a tsl: <link> that precedes the <command>,
  // built from the datasource and columns the caller resolved for the requested fields.
  const linkXml = isSpecificFilter
    ? `<link caption='${escapeXml(caption)}' delimiter=',' escape='\\' expression='${escapeXml(
        buildTslExpression(
          target,
          targetDatasource?.name ?? '',
          (resolvedFields ?? []).map((field) => field.columnName),
        ),
      )}' include-null='true' multi-select='true' url-escape='true' />`
    : '';

  const params: string[] = [];
  if (excludeSheets.length > 0) {
    params.push(`<param name='exclude' value='${escapeXml(excludeSheets.join(','))}' />`);
  }
  if (clearSelection === 'exclude-all') {
    params.push("<param name='on-empty' value='none' />");
  }
  if (singleSelect === true) {
    params.push("<param name='single-select' value='' />");
  }
  if (!isSpecificFilter) {
    params.push("<param name='special-fields' value='all' />");
  }
  params.push(`<param name='target' value='${escapeXml(target)}' />`);

  return (
    `<action caption='${escapeXml(caption)}' name='${escapeXml(actionName)}'>` +
    activationXml +
    sourceXml +
    linkXml +
    `<command command='tsc:tsl-filter'>${params.join('')}</command>` +
    '</action>'
  );
}

// Readback predicate for url mode: the caption-matched legacy <action> must carry a
// <link> whose expression survived AND must have NO <command> child. A <command> payload
// is not recognized as a URL action, so an action that persisted with one is not a
// working URL action.
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
    // unescapeXml reverses exactly one escaping pass, so it maps the stored expression
    // back to the caller's raw url only when the action was written cleanly. A
    // double-escaped or otherwise mangled expression unescapes to something that is not
    // the caller's url, so this comparison reports it as not-applied.
    return unescapeXml(linkExpression) === expression;
  });
}

// Shared skeleton for the action-dedup guards: iterate every <action> block and report a
// duplicate when the block's <source> worksheet/dashboard match (attribute-order-independent,
// via getAttr) AND the type-specific predicate accepts the block's non-source content.
function hasDuplicateActionForSource(
  xml: string,
  sourceWorksheet: string,
  sourceDashboard: string,
  matchesTypeSpecific: (block: string) => boolean,
): boolean {
  return [...xml.matchAll(/<action\b[^>]*>[\s\S]*?<\/action>/g)].some((match) => {
    const block = match[0];
    if (!matchesTypeSpecific(block)) {
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

// Dedup guard: the document-apply path appends, so a same-url + same-source action
// authored under a different caption would silently double. Caption collision is
// handled separately by hasActionCaption.
function hasUrlActionDuplicate(
  xml: string,
  expression: string,
  sourceWorksheet: string,
  sourceDashboard: string,
): boolean {
  return hasDuplicateActionForSource(xml, sourceWorksheet, sourceDashboard, (block) => {
    const linkTag = block.match(/<link\b[^>]*>/)?.[0];
    if (linkTag === undefined) {
      return false;
    }
    const linkExpression = getAttr(linkTag, 'expression');
    return linkExpression !== undefined && unescapeXml(linkExpression) === expression;
  });
}

// Readback predicate for filter mode: the caption-matched legacy <action> must carry a
// <command command='tsc:tsl-filter'> whose target param survived. An action that
// persisted under a different command (or lost its target) is not a working filter action.
// For a specific-field filter the fields live in a tsl: <link> (as url mode's <link>), so its
// expression must survive as well
function hasFilterActionWithTarget(
  xml: string,
  caption: string,
  target: string,
  linkExpression?: string,
): boolean {
  return [...xml.matchAll(/<action\b[^>]*>[\s\S]*?<\/action>/g)].some((match) => {
    const block = match[0];
    const openingTag = block.match(/^<action\b[^>]*>/)?.[0];
    if (openingTag === undefined || unescapeXml(getAttr(openingTag, 'caption') ?? '') !== caption) {
      return false;
    }
    const commandTag = block.match(/<command\b[^>]*>/)?.[0];
    if (commandTag === undefined || getAttr(commandTag, 'command') !== 'tsc:tsl-filter') {
      return false;
    }
    const hasTarget = [...block.matchAll(/<param\b[^>]*>/g)].some(
      (paramMatch) =>
        getAttr(paramMatch[0], 'name') === 'target' &&
        unescapeXml(getAttr(paramMatch[0], 'value') ?? '') === target,
    );
    if (!hasTarget) {
      return false;
    }
    if (linkExpression !== undefined) {
      const linkTag = block.match(/<link\b[^>]*>/)?.[0];
      const expression = linkTag === undefined ? undefined : getAttr(linkTag, 'expression');
      if (expression === undefined || unescapeXml(expression) !== linkExpression) {
        return false;
      }
    }
    return true;
  });
}

// Dedup guard: the document-apply path appends, so a same-source + same-target + same-fields
// filter action authored under a different caption would silently double.
// Caption collision is handled separately by hasActionCaption.
function hasFilterActionDuplicate(
  xml: string,
  target: string,
  sourceWorksheet: string,
  sourceDashboard: string,
  linkExpression?: string,
): boolean {
  return hasDuplicateActionForSource(xml, sourceWorksheet, sourceDashboard, (block) => {
    const commandTag = block.match(/<command\b[^>]*>/)?.[0];
    if (commandTag === undefined || getAttr(commandTag, 'command') !== 'tsc:tsl-filter') {
      return false;
    }
    const sameTarget = [...block.matchAll(/<param\b[^>]*>/g)].some(
      (paramMatch) =>
        getAttr(paramMatch[0], 'name') === 'target' &&
        unescapeXml(getAttr(paramMatch[0], 'value') ?? '') === target,
    );
    if (!sameTarget) {
      return false;
    }
    const linkTag = block.match(/<link\b[^>]*>/)?.[0];
    const existingExpression =
      linkTag === undefined ? undefined : unescapeXml(getAttr(linkTag, 'expression') ?? '');
    return existingExpression === linkExpression;
  });
}

// Where an action should be spliced: inside an existing <actions> block (innerStart just past
// <actions>, close at </actions>), or in a fresh block anchored right after the top-level
// </datasources> when none exists yet.
type ActionsSite =
  | { kind: 'existing'; innerStart: number; close: number }
  | { kind: 'fresh'; insertAt: number };

function locateActionsSite(xml: string): Result<ActionsSite, XmlModificationError> {
  const actionsOpen = xml.indexOf('<actions>');
  if (actionsOpen !== -1) {
    const close = xml.indexOf('</actions>', actionsOpen);
    if (close === -1) {
      return new XmlModificationError('malformed document: <actions> without </actions>').toErr();
    }
    return new Ok({ kind: 'existing', innerStart: actionsOpen + '<actions>'.length, close });
  }

  const dsClose = xml.indexOf('</datasources>');
  if (dsClose === -1) {
    return new XmlModificationError(
      'cannot place actions: no </datasources> anchor in document',
    ).toErr();
  }
  return new Ok({ kind: 'fresh', insertAt: dsClose + '</datasources>'.length });
}

// twb_2026.2.0.xsd fixes the child order of <actions> as a sequence of families:
//   legacy <action> -> <datasources>/<datasource-dependencies> -> <nav-action>
//   -> <edit-group-action> (set) -> <edit-parameter-action> (parameter).
// Each family's elements must stay grouped and in this order.
const ACTION_FAMILY_MARKERS: readonly RegExp[] = [
  /<action\b/,
  /<datasources>|<datasource-dependencies\b/,
  /<nav-action\b/,
  /<edit-group-action\b/,
  /<edit-parameter-action\b/,
];

// The family index of the element about to be inserted, read from its opening tag.
// This tool authors only legacy <action>, <edit-group-action>, and <edit-parameter-action>.
function actionFamilyIndex(actionXml: string): number {
  if (actionXml.startsWith('<edit-parameter-action')) return 4;
  if (actionXml.startsWith('<edit-group-action')) return 3;
  if (actionXml.startsWith('<nav-action')) return 2;
  return 0; // legacy <action> (url + filter)
}

// Offset within the <actions> body at which a new element of `familyIndex` belongs:
// just before the first element of any later family, else the end of the body.
function familySlotOffset(inner: string, familyIndex: number): number {
  let offset = inner.length;
  for (let later = familyIndex + 1; later < ACTION_FAMILY_MARKERS.length; later += 1) {
    const match = ACTION_FAMILY_MARKERS[later].exec(inner);
    if (match !== null && match.index < offset) {
      offset = match.index;
    }
  }
  return offset;
}

// Splice a new action into the workbook-level <actions> block, creating the block between
// </datasources> and <worksheets> if it does not yet exist. The action lands in its XSD
// family slot (see ACTION_FAMILY_MARKERS) rather than at the end of the block.
function spliceActionIntoWorkbook(
  xml: string,
  actionXml: string,
  deps?: { datasourceName: string; datasourceXml: string; columnsXml: string[] },
): Result<string, XmlModificationError> {
  const siteResult = locateActionsSite(xml);
  if (siteResult.isErr()) {
    return siteResult.error.toErr();
  }
  const site = siteResult.value;

  if (site.kind === 'existing') {
    let inner = xml.slice(site.innerStart, site.close);

    // Extract any existing <datasources>/<datasource-dependencies> from the body
    // so the new deps can be re-merged into that slot
    let mergedMetadata = '';
    if (deps !== undefined) {
      let nestedDatasources = '';
      inner = inner.replace(/<datasources>[\s\S]*?<\/datasources>/, (block) => {
        nestedDatasources = block;
        return '';
      });
      const dependencyBlocks: string[] = [];
      inner = inner.replace(
        /<datasource-dependencies\b[\s\S]*?<\/datasource-dependencies>/g,
        (block) => {
          dependencyBlocks.push(block);
          return '';
        },
      );
      mergedMetadata =
        mergeActionDatasources(nestedDatasources, deps.datasourceName, deps.datasourceXml) +
        mergeDependencyBlocks(dependencyBlocks, deps.datasourceName, deps.columnsXml);
    }

    const offset = familySlotOffset(inner, actionFamilyIndex(actionXml));
    const merged = `${inner.slice(0, offset)}${actionXml}${mergedMetadata}${inner.slice(offset)}`;
    return new Ok(`${xml.slice(0, site.innerStart)}${merged}${xml.slice(site.close)}`);
  }

  // No <actions> block yet: there are no existing siblings to merge, so build a fresh block.
  const actionsBody =
    deps === undefined
      ? actionXml
      : `${actionXml}` +
        mergeActionDatasources('', deps.datasourceName, deps.datasourceXml) +
        mergeDependencyBlocks([], deps.datasourceName, deps.columnsXml);
  return new Ok(
    `${xml.slice(0, site.insertAt)}<actions>${actionsBody}</actions>${xml.slice(site.insertAt)}`,
  );
}

// Add the datasource entry to the nested <datasources> block, creating the block if absent and
// skipping a datasource that is already listed (matched by internal name).
function mergeActionDatasources(
  existing: string,
  datasourceName: string,
  datasourceXml: string,
): string {
  if (existing === '') {
    return `<datasources>${datasourceXml}</datasources>`;
  }
  const present = [...existing.matchAll(/<datasource\b[^>]*\/>/g)].some(
    (match) => unescapeXml(getAttr(match[0], 'name') ?? '') === datasourceName,
  );
  if (present) {
    return existing;
  }
  return existing.replace('</datasources>', `${datasourceXml}</datasources>`);
}

// Add the columns to the <datasource-dependencies> block for this datasource, creating the block if
// none matches and appending only columns not already declared (matched by name).
function mergeDependencyBlocks(
  blocks: string[],
  datasourceName: string,
  columnsXml: string[],
): string {
  const index = blocks.findIndex((block) => {
    const openTag = block.match(/<datasource-dependencies\b[^>]*>/)?.[0];
    return (
      openTag !== undefined && unescapeXml(getAttr(openTag, 'datasource') ?? '') === datasourceName
    );
  });
  if (index === -1) {
    return (
      blocks.join('') +
      `<datasource-dependencies datasource='${escapeXml(datasourceName)}'>${columnsXml.join('')}</datasource-dependencies>`
    );
  }
  const block = blocks[index];
  const existingNames = new Set(
    [...block.matchAll(/<column\b[^>]*\/>/g)].map((match) =>
      unescapeXml(getAttr(match[0], 'name') ?? ''),
    ),
  );
  const additions = columnsXml.filter(
    (column) => !existingNames.has(unescapeXml(getAttr(column, 'name') ?? '')),
  );
  const merged = [...blocks];
  if (additions.length > 0) {
    merged[index] = block.replace(
      '</datasource-dependencies>',
      `${additions.join('')}</datasource-dependencies>`,
    );
  }
  return merged.join('');
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
