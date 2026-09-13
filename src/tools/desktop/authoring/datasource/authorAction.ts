import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { DOMParser, type Element as XmlElement } from '@xmldom/xmldom';
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
import { findDatasourceElements, selectTargetDatasource } from './authorCalcCore.js';

const activationSchema = z.enum(['on-select', 'on-hover', 'on-menu']);
const modeSchema = z.enum(['parameter', 'set', 'url', 'filter']);
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
  mode: modeSchema
    .default('parameter')
    .describe(
      'Action type. parameter requires sourceField and a qualified targetParameter; set requires an existing targetSet; url requires url and a worksheet or dashboard source; filter requires a dashboard source worksheet and targetWorksheets.',
    ),
  caption: z.string().describe('Unique action caption.'),
  sourceWorksheet: z.string().describe('Source worksheet name.'),
  sourceField: z.string().optional().describe('Parameter mode source field.'),
  targetParameter: z
    .string()
    .optional()
    .describe('Parameter mode target, qualified as [Parameters].[Name].'),
  targetSet: z.string().optional().describe('Set mode existing set name.'),
  datasource: z.string().optional().describe('Internal datasource name or unique caption.'),
  setMembership: setMembershipSchema.default('assign').describe(''),
  clearSelection: clearSelectionSchema
    .optional()
    .describe('Selection-clear behavior; filter mode defaults to show-all.'),
  singleSelect: z.boolean().optional().describe(''),
  activation: activationSchema.default('on-select').describe(''),
  url: z
    .string()
    .optional()
    .describe(
      'URL for url mode. Pass it raw and unescaped (the tool escapes it). Use <[Field Name]> to insert a field value.',
    ),
  sourceDashboard: z.string().optional().describe('Source dashboard name.'),
  targetWorksheets: z
    .array(z.string())
    .optional()
    .describe(
      'Filter mode target worksheets in the source dashboard; all must share one datasource.',
    ),
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
        targetWorksheets: string[];
      }
  );

type PreparedAction = {
  actionXml: string;
  isLanded: (xml: string) => boolean;
  readbackFailureMessage: string;
  buildResult: (readbackXml: string) => Result<AuthorActionResult, XmlModificationError>;
};

type PrepareAction = () => Result<PreparedAction, ArgsValidationError>;

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
    description: 'Add a parameter, set, URL, or dashboard filter action.',
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
        clearSelection,
        singleSelect,
        activation = 'on-select',
        url,
        sourceDashboard,
        targetWorksheets,
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
          targetWorksheets,
          excludeSheets,
          urlTarget,
          zoneId,
          urlEncode,
        },
        callback: async () => {
          const resolvedClearSelection =
            clearSelection ?? (mode === 'filter' ? 'show-all' : 'do-nothing');
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
          if (mode === 'filter') {
            const trimmedDashboard = sourceDashboard?.trim() ?? '';
            if (trimmedDashboard.length === 0) {
              return new ArgsValidationError('sourceDashboard is required in filter mode').toErr();
            }
            const trimmedTargets = (targetWorksheets ?? []).map((sheet) => sheet.trim());
            if (trimmedTargets.length === 0 || trimmedTargets.some((sheet) => sheet.length === 0)) {
              return new ArgsValidationError(
                'targetWorksheets must be a nonempty list of worksheet names in filter mode',
              ).toErr();
            }
            if (new Set(trimmedTargets).size !== trimmedTargets.length) {
              return new ArgsValidationError(
                'targetWorksheets must contain unique worksheet names',
              ).toErr();
            }
            if (activation !== 'on-select') {
              return new ArgsValidationError(
                'filter mode currently supports activation on-select only',
              ).toErr();
            }
            if (singleSelect !== undefined) {
              return new ArgsValidationError(
                'singleSelect is not supported in filter mode',
              ).toErr();
            }
            if (setMembership !== 'assign') {
              return new ArgsValidationError(
                'setMembership add/remove is not supported in filter mode',
              ).toErr();
            }
            if (
              (sourceField?.trim().length ?? 0) > 0 ||
              (targetParameter?.trim().length ?? 0) > 0 ||
              (targetSet?.trim().length ?? 0) > 0 ||
              (datasource?.trim().length ?? 0) > 0 ||
              (url?.trim().length ?? 0) > 0 ||
              (excludeSheets?.length ?? 0) > 0 ||
              urlTarget !== undefined ||
              (zoneId?.trim().length ?? 0) > 0 ||
              urlEncode !== undefined
            ) {
              return new ArgsValidationError(
                'sourceField, targets for other modes, datasource, URL options, and excludeSheets are not allowed in filter mode',
              ).toErr();
            }
          }
          if (mode !== 'filter' && (targetWorksheets?.length ?? 0) > 0) {
            return new ArgsValidationError(
              'targetWorksheets is only allowed in filter mode',
            ).toErr();
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
          let filterPlan: FilterPlan | undefined;
          if (mode !== 'filter' && hasActionCaption(liveXml, caption)) {
            return new ArgsValidationError(
              'caption collision — pick a new caption or edit the existing action',
            ).toErr();
          }
          if (mode === 'filter') {
            const resolvedPlan = resolveFilterPlan({
              liveXml,
              caption,
              sourceDashboard: sourceDashboard!.trim(),
              sourceWorksheet: sourceWorksheet.trim(),
              targetWorksheets: targetWorksheets!.map((sheet) => sheet.trim()),
              clearSelection: resolvedClearSelection,
            });
            if (resolvedPlan.isErr()) {
              return resolvedPlan.error.toErr();
            }
            filterPlan = resolvedPlan.value;
            if (filterPlan.existingActionName !== undefined) {
              return new Ok({
                actionName: filterPlan.existingActionName,
                caption,
                mode,
                target: sourceDashboard!.trim(),
                targetWorksheets: filterPlan.targetWorksheets,
                hint: 'the existing filter action matches the complete supported semantics',
              });
            }
          }
          if (mode === 'url') {
            // Worksheet, dashboard, and story names share one namespace, so a source name
            // is unambiguously one kind. Emitting <source worksheet='<dashboard>'> (a
            // dashboard name in the worksheet slot) persists cleanly but makes Tableau raise
            // an internal error when the action is later opened for editing, because it then
            // resolves that name as a worksheet and finds a dashboard instead. Reject the
            // miscategorized source up front and steer the caller to the correct slot.
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
          const prepareActionByMode: Record<z.infer<typeof modeSchema>, PrepareAction> = {
            filter: () => {
              const target = sourceDashboard!.trim();
              const semantics: FilterActionSemantics = {
                caption,
                sourceDashboard: target,
                sourceWorksheet: sourceWorksheet.trim(),
                excludedWorksheets: filterPlan!.excludedWorksheets,
                clearSelection: resolvedClearSelection,
              };
              const readbackFailureMessage =
                'action applied but the complete filter action did not survive readback';
              return new Ok({
                actionXml: renderFilterAction({ ...semantics, actionName }),
                isLanded: (xml) => findSupportedFilterAction(xml, semantics) !== undefined,
                readbackFailureMessage,
                buildResult: (readbackXml) => {
                  const readbackActionName = findSupportedFilterAction(readbackXml, semantics);
                  if (readbackActionName === undefined) {
                    return new XmlModificationError(readbackFailureMessage).toErr();
                  }
                  return new Ok({
                    actionName: readbackActionName,
                    caption,
                    mode: 'filter',
                    target,
                    targetWorksheets: targetWorksheets!.map((sheet) => sheet.trim()),
                    hint: 'readback verified an on-select filter action across all fields, with show all as the default when the selection clears',
                  });
                },
              });
            },
            set: () => {
              const targetResult = resolveTargetSet(liveXml, targetSet, datasource);
              if (targetResult.isErr()) {
                return targetResult.error.toErr();
              }
              const target = targetResult.value;
              return new Ok({
                actionXml: renderSetAction({
                  caption,
                  actionName,
                  sourceWorksheet,
                  targetSet: target,
                  setMembership,
                  clearSelection: resolvedClearSelection,
                  singleSelect,
                  activation,
                }),
                isLanded: (xml) =>
                  hasActionWithTargetParam(
                    xml,
                    'edit-group-action',
                    caption,
                    'target-group',
                    target,
                  ),
                readbackFailureMessage:
                  'action applied but the target-group param did not survive readback',
                buildResult: () =>
                  new Ok({
                    actionName,
                    caption,
                    mode: 'set',
                    target,
                    targetSet: target,
                    hint: 'readback verified the qualified target set; the source sheet must expose marks that can drive the action',
                  }),
              });
            },
            url: () => {
              const target = url!.trim();
              return new Ok({
                actionXml: renderUrlAction({
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
                }),
                isLanded: (xml) => hasUrlActionWithLink(xml, caption, target),
                readbackFailureMessage:
                  'action applied but the <link> URL did not survive readback (it may have been dropped or rewritten as a command action)',
                buildResult: () =>
                  new Ok({
                    actionName,
                    caption,
                    mode: 'url',
                    target,
                    url: target,
                    hint: 'readback verified the <link> URL action; the source sheet/dashboard must expose marks that drive the action, and any <[Field]> references must resolve on the source view',
                  }),
              });
            },
            parameter: () => {
              const target = targetParameter!.trim();
              return new Ok({
                actionXml: renderParameterAction({
                  caption,
                  actionName,
                  sourceWorksheet,
                  sourceField: sourceField ?? '',
                  targetParameter: target,
                  activation,
                }),
                isLanded: (xml) =>
                  hasActionWithTargetParam(
                    xml,
                    'edit-parameter-action',
                    caption,
                    'target-parameter',
                    target,
                  ),
                readbackFailureMessage:
                  'action applied but the target-parameter param did not survive readback',
                buildResult: () =>
                  new Ok({
                    actionName,
                    caption,
                    mode: 'parameter',
                    target,
                    targetParameter: target,
                    hint: 'the source sheet must expose the source field; the target parameter must already exist (author it at open time)',
                  }),
              });
            },
          };
          const preparedResult = prepareActionByMode[mode]();
          if (preparedResult.isErr()) {
            return preparedResult.error.toErr();
          }
          const prepared = preparedResult.value;
          const editResult = spliceActionIntoWorkbook(liveXml, prepared.actionXml);
          if (editResult.isErr()) {
            return editResult.error.toErr();
          }
          const editedXml = editResult.value;

          const validation = validateWorkbookDocumentApply(editedXml, liveXml);
          if (!validation.ok) {
            return new ArgsValidationError(validation.message).toErr();
          }

          const outcome = await applyAndVerify({
            xml: editedXml,
            baselineXml: liveXml,
            settled: prepared.isLanded,
            executor,
            signal: extra.signal,
          });
          if (outcome.status === 'failed') {
            return outcome.error.toErr();
          }
          if (outcome.status === 'not-applied') {
            return new XmlModificationError(prepared.readbackFailureMessage).toErr();
          }
          return prepared.buildResult(outcome.workbookXml);
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

type FilterPlan = {
  targetWorksheets: string[];
  excludedWorksheets: string[];
  existingActionName?: string;
};

type FilterActionSemantics = {
  caption: string;
  sourceDashboard: string;
  sourceWorksheet: string;
  excludedWorksheets: string[];
  clearSelection: z.infer<typeof clearSelectionSchema>;
};

function resolveFilterPlan({
  liveXml,
  caption,
  sourceDashboard,
  sourceWorksheet,
  targetWorksheets,
  clearSelection,
}: {
  liveXml: string;
  caption: string;
  sourceDashboard: string;
  sourceWorksheet: string;
  targetWorksheets: string[];
  clearSelection: z.infer<typeof clearSelectionSchema>;
}): Result<FilterPlan, ArgsValidationError> {
  const root = parseWorkbook(liveXml);
  if (root === undefined) {
    return new ArgsValidationError('cannot inspect filter action: malformed workbook XML').toErr();
  }
  const worksheets = directNamedElements(root, 'worksheets', 'worksheet');
  const worksheetByName = new Map(
    worksheets.flatMap((worksheet): [string, XmlElement][] => {
      const name = worksheet.getAttribute('name');
      return name === null || name === '' ? [] : [[name, worksheet]];
    }),
  );
  const dashboards = directNamedElements(root, 'dashboards', 'dashboard');
  const dashboardMatches = dashboards.filter(
    (dashboard) => dashboard.getAttribute('name') === sourceDashboard,
  );
  if (dashboardMatches.length !== 1) {
    return new ArgsValidationError(
      `Dashboard "${sourceDashboard}" was not found uniquely in the live workbook`,
    ).toErr();
  }

  const dashboardWorksheets: string[] = [];
  const dashboardWorksheetSet = new Set<string>();
  for (const zone of elementsByTagName(dashboardMatches[0], 'zone')) {
    const name = zone.getAttribute('name');
    if (name !== null && worksheetByName.has(name) && !dashboardWorksheetSet.has(name)) {
      dashboardWorksheets.push(name);
      dashboardWorksheetSet.add(name);
    }
  }
  const requested = [sourceWorksheet, ...targetWorksheets];
  for (const worksheetName of requested) {
    if (!worksheetByName.has(worksheetName)) {
      return new ArgsValidationError(
        `Worksheet "${worksheetName}" was not found in the live workbook`,
      ).toErr();
    }
    if (!dashboardWorksheetSet.has(worksheetName)) {
      return new ArgsValidationError(
        `Worksheet "${worksheetName}" is not a member of dashboard "${sourceDashboard}"`,
      ).toErr();
    }
  }

  let sharedDatasource: string | undefined;
  for (const worksheetName of requested) {
    const datasourceNames = worksheetDatasourceNames(worksheetByName.get(worksheetName)!);
    if (datasourceNames.length !== 1) {
      return new ArgsValidationError(
        `Worksheet "${worksheetName}" must use exactly one datasource in filter mode; found ${datasourceNames.length}`,
      ).toErr();
    }
    if (sharedDatasource === undefined) {
      sharedDatasource = datasourceNames[0];
    } else if (sharedDatasource !== datasourceNames[0]) {
      return new ArgsValidationError(
        `Filter source and target worksheets must use the same datasource; "${sourceWorksheet}" uses "${sharedDatasource}" while "${worksheetName}" uses "${datasourceNames[0]}"`,
      ).toErr();
    }
  }

  const targetSet = new Set(targetWorksheets);
  const excludedWorksheets = dashboardWorksheets.filter((name) => !targetSet.has(name));
  const desired = {
    caption,
    sourceDashboard,
    sourceWorksheet,
    excludedWorksheets,
    clearSelection,
  };
  const sameCaption = actionElements(root).filter(
    (action) => action.getAttribute('caption') === caption,
  );
  if (sameCaption.length > 0) {
    const existingActionName =
      sameCaption.length === 1 ? matchesSupportedFilterAction(sameCaption[0], desired) : undefined;
    if (existingActionName === undefined) {
      return new ArgsValidationError(
        'caption collision — the existing action has different or unsupported semantics; no changes were applied',
      ).toErr();
    }
    return new Ok({ targetWorksheets, excludedWorksheets, existingActionName });
  }
  return new Ok({ targetWorksheets, excludedWorksheets });
}

function renderFilterAction({
  caption,
  actionName,
  sourceDashboard,
  sourceWorksheet,
  excludedWorksheets,
  clearSelection,
}: FilterActionSemantics & { actionName: string }): string {
  const autoClear = clearSelection === 'do-nothing' ? '' : " auto-clear='true'";
  const excludeParam =
    excludedWorksheets.length === 0
      ? ''
      : `<param name='exclude' value='${escapeXml(tableauList(excludedWorksheets))}' />`;
  const onEmptyParam =
    clearSelection === 'exclude-all' ? "<param name='on-empty' value='none' />" : '';
  return (
    `<action caption='${escapeXml(caption)}' name='${escapeXml(actionName)}'>` +
    `<activation${autoClear} type='on-select' />` +
    `<source dashboard='${escapeXml(sourceDashboard)}' type='sheet' worksheet='${escapeXml(sourceWorksheet)}' />` +
    "<command command='tsc:tsl-filter'>" +
    excludeParam +
    onEmptyParam +
    "<param name='special-fields' value='all' />" +
    `<param name='target' value='${escapeXml(sourceDashboard)}' />` +
    '</command></action>'
  );
}

function findSupportedFilterAction(
  xml: string,
  desired: FilterActionSemantics,
): string | undefined {
  const root = parseWorkbook(xml);
  if (root === undefined) return undefined;
  const matches = actionElements(root).filter(
    (action) => action.getAttribute('caption') === desired.caption,
  );
  return matches.length === 1 ? matchesSupportedFilterAction(matches[0], desired) : undefined;
}

function matchesSupportedFilterAction(
  action: XmlElement,
  desired: FilterActionSemantics,
): string | undefined {
  if (action.tagName !== 'action' || !hasOnlyAttributes(action, ['caption', 'name'])) {
    return undefined;
  }
  const actionName = action.getAttribute('name');
  if (
    actionName === null ||
    actionName.length === 0 ||
    action.getAttribute('caption') !== desired.caption
  ) {
    return undefined;
  }
  const children = directElementChildren(action);
  if (
    children.length !== 3 ||
    children[0].tagName !== 'activation' ||
    children[1].tagName !== 'source' ||
    children[2].tagName !== 'command' ||
    !hasWhitespaceOnlyText(action)
  ) {
    return undefined;
  }
  const [activation, source, command] = children;
  const expectedActivationAttrs =
    desired.clearSelection === 'do-nothing' ? ['type'] : ['auto-clear', 'type'];
  if (
    !hasOnlyAttributes(activation, expectedActivationAttrs) ||
    activation.getAttribute('type') !== 'on-select' ||
    activation.getAttribute('auto-clear') !==
      (desired.clearSelection === 'do-nothing' ? null : 'true') ||
    directElementChildren(activation).length !== 0 ||
    !hasWhitespaceOnlyText(activation)
  ) {
    return undefined;
  }
  if (
    !hasOnlyAttributes(source, ['dashboard', 'type', 'worksheet']) ||
    source.getAttribute('type') !== 'sheet' ||
    source.getAttribute('dashboard') !== desired.sourceDashboard ||
    source.getAttribute('worksheet') !== desired.sourceWorksheet ||
    directElementChildren(source).length !== 0 ||
    !hasWhitespaceOnlyText(source)
  ) {
    return undefined;
  }
  if (
    !hasOnlyAttributes(command, ['command']) ||
    command.getAttribute('command') !== 'tsc:tsl-filter' ||
    !hasWhitespaceOnlyText(command)
  ) {
    return undefined;
  }
  const params = directElementChildren(command);
  if (
    params.some(
      (param) => param.tagName !== 'param' || !hasOnlyAttributes(param, ['name', 'value']),
    )
  ) {
    return undefined;
  }
  const actualParams = new Map<string, string>();
  for (const param of params) {
    if (directElementChildren(param).length !== 0 || !hasWhitespaceOnlyText(param))
      return undefined;
    const name = param.getAttribute('name');
    const value = param.getAttribute('value');
    if (name === null || value === null || actualParams.has(name)) return undefined;
    actualParams.set(name, value);
  }
  const expectedParams = new Map<string, string>([
    ['special-fields', 'all'],
    ['target', desired.sourceDashboard],
  ]);
  if (desired.clearSelection === 'exclude-all') {
    expectedParams.set('on-empty', 'none');
  }
  const actualExclude = actualParams.get('exclude');
  const expectsExclusions = desired.excludedWorksheets.length > 0;
  if (
    expectsExclusions
      ? actualExclude === undefined ||
        !tableauListSetsEqual(actualExclude, desired.excludedWorksheets)
      : actualExclude !== undefined
  ) {
    return undefined;
  }
  if (actualParams.size !== expectedParams.size + (expectsExclusions ? 1 : 0)) return undefined;
  for (const [name, value] of expectedParams) {
    if (actualParams.get(name) !== value) return undefined;
  }
  return actionName;
}

function tableauListSetsEqual(encodedActual: string, expected: string[]): boolean {
  const actual = parseTableauList(encodedActual);
  if (actual === undefined) return false;
  const sortedActual = [...new Set(actual)].sort();
  const sortedExpected = [...new Set(expected)].sort();
  return (
    sortedActual.length === sortedExpected.length &&
    sortedActual.every((member, index) => member === sortedExpected[index])
  );
}

function parseTableauList(encoded: string): string[] | undefined {
  const members: string[] = [];
  let member = '';
  for (let index = 0; index < encoded.length; index += 1) {
    const character = encoded[index];
    if (character === '\\') {
      const escaped = encoded[index + 1];
      if (escaped !== '\\' && escaped !== ',') return undefined;
      member += escaped;
      index += 1;
    } else if (character === ',') {
      if (member.length === 0) return undefined;
      members.push(member);
      member = '';
    } else {
      member += character;
    }
  }
  if (member.length === 0) return undefined;
  members.push(member);
  return members;
}

function parseWorkbook(xml: string): XmlElement | undefined {
  const document = new DOMParser({ errorHandler: () => {} }).parseFromString(
    xml,
    'application/xml',
  );
  return document.documentElement?.tagName === 'workbook' ? document.documentElement : undefined;
}

function directNamedElements(
  root: XmlElement,
  containerTag: string,
  elementTag: string,
): XmlElement[] {
  const containers = directElementChildren(root).filter(
    (element) => element.tagName === containerTag,
  );
  return containers.flatMap((container) =>
    directElementChildren(container).filter((element) => element.tagName === elementTag),
  );
}

function actionElements(root: XmlElement): XmlElement[] {
  return directNamedElements(root, 'actions', 'action').concat(
    directNamedElements(root, 'actions', 'edit-parameter-action'),
    directNamedElements(root, 'actions', 'edit-group-action'),
  );
}

function worksheetDatasourceNames(worksheet: XmlElement): string[] {
  const names = new Set<string>();
  for (const container of elementsByTagName(worksheet, 'datasources')) {
    for (const datasource of directElementChildren(container)) {
      const name = datasource.getAttribute('name');
      if (
        datasource.tagName === 'datasource' &&
        name !== null &&
        name.length > 0 &&
        name !== 'Parameters'
      ) {
        names.add(name);
      }
    }
  }
  return [...names];
}

function elementsByTagName(element: XmlElement, tagName: string): XmlElement[] {
  return Array.from(element.getElementsByTagName(tagName));
}

function directElementChildren(element: XmlElement): XmlElement[] {
  return Array.from(element.childNodes)
    .filter((node) => node.nodeType === 1)
    .map((node) => node as XmlElement);
}

function hasWhitespaceOnlyText(element: XmlElement): boolean {
  return Array.from(element.childNodes).every(
    (node) => node.nodeType === 1 || (node.nodeValue ?? '').trim().length === 0,
  );
}

function hasOnlyAttributes(element: XmlElement, expectedNames: string[]): boolean {
  const actualNames = Array.from(element.attributes)
    .map((attribute) => attribute.name)
    .sort();
  return actualNames.join('\0') === [...expectedNames].sort().join('\0');
}

function tableauList(values: string[]): string {
  return values.map((value) => value.replaceAll('\\', '\\\\').replaceAll(',', '\\,')).join(',');
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
    `<activation type='${activation}' />` +
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
