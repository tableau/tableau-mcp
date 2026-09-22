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
  findWorkbookParameters,
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
  mode: modeSchema
    .default('parameter')
    .describe(
      'Which target a mark interaction drives, and the field that mode needs: ' +
        'parameter (needs sourceField and targetParameter), set (needs targetSet), ' +
        'url (needs url), filter (needs targetSheet). Defaults to parameter.',
    ),
  caption: z.string().describe('Action name shown to the user; must be unique in the workbook.'),
  sourceWorksheet: z
    .string()
    .describe(
      'Worksheet whose marks drive the action. Required for parameter and set modes; ' +
        'for url and filter modes pass this or sourceDashboard.',
    ),
  sourceField: z
    .string()
    .optional()
    .describe(
      'parameter mode only, required there: the source field whose value is pushed to the ' +
        'target parameter, e.g. [Profit].',
    ),
  targetParameter: z
    .string()
    .optional()
    .describe(
      'parameter mode only, required there: the parameter to set, fully qualified like ' +
        '[Parameters].[Parameter 1].',
    ),
  targetSet: z
    .string()
    .optional()
    .describe('set mode only, required there: the set whose membership the selected marks change.'),
  targetSheet: z
    .string()
    .optional()
    .describe(
      'filter mode only, required there: the worksheet or dashboard the source marks filter.',
    ),
  filterFields: z
    .array(z.string())
    .optional()
    .describe('filter mode only: fields to filter on; omit to filter on all shared fields.'),
  datasource: z.string().optional().describe('Internal name or caption.'),
  setMembership: setMembershipSchema.default('assign').describe(''),
  clearSelection: clearSelectionSchema.default('do-nothing').describe(''),
  singleSelect: z.boolean().optional().describe(''),
  activation: activationSchema.default('on-select').describe(''),
  url: z.string().optional().describe('URL for url mode, raw. <[Field Name]> = value.'),
  sourceDashboard: z
    .string()
    .optional()
    .describe(
      'Dashboard whose marks drive the action, for url and filter modes; pass instead of or ' +
        'alongside sourceWorksheet.',
    ),
  excludeSourceSheets: z.array(z.string()).optional().describe(''),
  excludeTargetSheets: z.array(z.string()).optional().describe(''),
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
        excludeSourceSheets: string[];
        excludeTargetSheets: string[];
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
    description:
      'Wire a mark interaction to a target. Pick mode and pass its required field: ' +
      'parameter (sourceField + targetParameter), set (targetSet), url (url), filter (targetSheet).',
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
        excludeSourceSheets,
        excludeTargetSheets,
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
          excludeSourceSheets,
          excludeTargetSheets,
          urlTarget,
          zoneId,
          urlEncode,
        },
        callback: async () => {
          const effectiveSourceSheet = sourceWorksheet.trim();
          const effectiveSourceDashboard = sourceDashboard?.trim() ?? '';
          const hasSourceWorksheet = effectiveSourceSheet.length > 0;
          const hasSourceDashboard = effectiveSourceDashboard.length > 0;
          const effectiveTargetSheet = targetSheet?.trim() ?? '';
          const effectiveExcludedSourceSheets = (excludeSourceSheets ?? [])
            .map((sheet) => sheet.trim())
            .filter((sheet) => sheet.length > 0);
          const effectiveExcludedTargetSheets = (excludeTargetSheets ?? [])
            .map((sheet) => sheet.trim())
            .filter((sheet) => sheet.length > 0);

          if (caption.trim().length === 0) {
            return new ArgsValidationError('caption empty').toErr();
          }
          if (mode !== 'url' && mode !== 'filter' && effectiveSourceSheet.length === 0) {
            return new ArgsValidationError('sourceWorksheet empty').toErr();
          }
          if (effectiveExcludedTargetSheets.length > 0 && mode !== 'filter') {
            return new ArgsValidationError(
              'excludeTargetSheets is only allowed in filter mode',
            ).toErr();
          }
          if (effectiveExcludedSourceSheets.length > 0) {
            if (mode !== 'url' && mode !== 'filter') {
              return new ArgsValidationError(
                'excludeSourceSheets is only allowed in url or filter mode',
              ).toErr();
            }
            if (hasSourceWorksheet || !hasSourceDashboard) {
              return new ArgsValidationError(
                'excludeSourceSheets is only allowed with a dashboard-only source (set sourceDashboard, leave sourceWorksheet empty)',
              ).toErr();
            }
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
            if (!hasSourceWorksheet && !hasSourceDashboard) {
              return new ArgsValidationError(
                'url mode requires a source: set sourceWorksheet, sourceDashboard, or both',
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
          if (mode === 'parameter' && (targetSet?.trim().length ?? 0) > 0) {
            return new ArgsValidationError(
              'targetSet is not allowed in parameter mode; use targetParameter',
            ).toErr();
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
            if (!hasSourceWorksheet && !hasSourceDashboard) {
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

          // parameter mode needs a source field and an existing target parameter. Both errors
          // enumerate what the workbook actually offers — the same recovery guidance set mode
          // gives with "Available sets" — so a first miss becomes a fixable second call rather
          // than the repeated blind retries this tool used to provoke.
          let resolvedTargetParameter = '';
          if (mode === 'parameter') {
            // Reject empty/whitespace as well as undefined: renderParameterAction omits the
            // source-field param when it is blank, and the readback predicate only checks the
            // target survived — so a blank sourceField would otherwise apply a no-op action
            // (a target with no value to push) and report success. Mirrors targetParameter below.
            if (sourceField === undefined || sourceField.trim().length === 0) {
              return new ArgsValidationError(
                `sourceField is required in parameter mode. Available fields: ${formatAvailableFields(liveXml)}`,
              ).toErr();
            }
            if (targetParameter === undefined || targetParameter.trim().length === 0) {
              return new ArgsValidationError(
                `targetParameter is required in parameter mode. Available parameters: ${formatAvailableParameters(liveXml)}`,
              ).toErr();
            }
            const qualifiedTarget = /^\[(.+)\]\.\[(.+)\]$/.exec(targetParameter.trim());
            if (qualifiedTarget === null) {
              return new ArgsValidationError(
                `targetParameter must be fully qualified like [Parameters].[X]; unqualified targets can cause a blocking Tableau modal. Available parameters: ${formatAvailableParameters(liveXml)}`,
              ).toErr();
            }
            // The target parameter must already exist. Tableau persists an action pointing at a
            // phantom parameter without complaint — and the readback only checks the target
            // survived, not that it resolves — so the action is applied but can never fire.
            // Set mode rejects an unknown set the same way ("Set X was not found").
            //
            // Match on internal name OR caption, exactly as resolveTargetSet does: a parameter's
            // internal <column name> ([Parameter N]) is minted at creation and is independent of
            // its display caption, so a caller naming the parameter by the caption they see in the
            // Parameters pane must still resolve. Then emit the resolved INTERNAL token — Tableau
            // only resolves an action against the internal name, so serializing the raw caption
            // would write an unresolvable [Parameters].[Caption] that silently never fires.
            const requestedParameter = normalizeReferenceToken(qualifiedTarget[2]);
            const matchedParameter =
              normalizeReferenceToken(qualifiedTarget[1]) === 'Parameters'
                ? findWorkbookParameters(liveXml).find(
                    (parameter) =>
                      normalizeReferenceToken(parameter.name) === requestedParameter ||
                      (parameter.caption !== undefined &&
                        normalizeReferenceToken(parameter.caption) === requestedParameter),
                  )
                : undefined;
            if (matchedParameter === undefined) {
              return new ArgsValidationError(
                `targetParameter "${targetParameter.trim()}" was not found. Available parameters: ${formatAvailableParameters(liveXml)}`,
              ).toErr();
            }
            resolvedTargetParameter = `[Parameters].${bracketToken(matchedParameter.name)}`;
          }

          const worksheetNames = findElementNames(liveXml, 'worksheets', 'worksheet');
          const dashboardNames = findElementNames(liveXml, 'dashboards', 'dashboard');
          // parameter and set modes drive off a single required source worksheet. A name that
          // isn't a real worksheet persists as a source the action can never fire from, so reject
          // it and enumerate the worksheets — the same recovery filter mode already gives.
          if (mode === 'parameter' || mode === 'set') {
            if (!worksheetNames.has(effectiveSourceSheet)) {
              return new ArgsValidationError(
                `sourceWorksheet "${effectiveSourceSheet}" was not found. Available worksheets: ${worksheetNames.size > 0 ? [...worksheetNames].join(', ') : 'none'}`,
              ).toErr();
            }
          }
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

            // Verify that the source worksheet is on the source dashboard. A dashboard that
            // declares no worksheet zones leaves membership uninspectable, so reject rather than
            // emit a combined source whose worksheet may not be on the dashboard.
            if (hasSourceWorksheet && hasSourceDashboard) {
              const sourceZoneNames = findDashboardZoneNames(liveXml, effectiveSourceDashboard);
              if (sourceZoneNames === undefined) {
                return new ArgsValidationError(
                  `sourceDashboard "${effectiveSourceDashboard}" has no zones but sourceWorksheet "${effectiveSourceSheet}" was passed.`,
                ).toErr();
              }
              const members = [...sourceZoneNames].filter((name) => worksheetNames.has(name));
              if (!members.includes(effectiveSourceSheet)) {
                return new ArgsValidationError(
                  `sourceWorksheet "${effectiveSourceSheet}" is not on dashboard "${effectiveSourceDashboard}". Worksheets on "${effectiveSourceDashboard}": ${members.length > 0 ? members.join(', ') : 'none'}. Pass a worksheet that is on the dashboard, or omit sourceDashboard to scope the action to the worksheet.`,
                ).toErr();
              }
            }

            const trimmedTarget = targetSheet!.trim();
            if (!worksheetNames.has(trimmedTarget) && !dashboardNames.has(trimmedTarget)) {
              const available = [...worksheetNames, ...dashboardNames];
              return new ArgsValidationError(
                `targetSheet "${trimmedTarget}" was not found. Available sheets: ${available.length > 0 ? available.join(', ') : 'none'}`,
              ).toErr();
            }

            const excludedSourceSheetsResult = validateExcludedSheets(
              liveXml,
              worksheetNames,
              effectiveSourceDashboard,
              effectiveExcludedSourceSheets,
              'Source must be a dashboard when there are excluded source sheets',
            );
            if (excludedSourceSheetsResult !== undefined) {
              return excludedSourceSheetsResult.toErr();
            }

            const excludedTargetSheetsResult = validateExcludedSheets(
              liveXml,
              worksheetNames,
              effectiveTargetSheet,
              effectiveExcludedTargetSheets,
              'Target must be a dashboard when there are excluded target sheets',
            );
            if (excludedTargetSheetsResult !== undefined) {
              return excludedTargetSheetsResult.toErr();
            }
          }

          let filterDependencies:
            | { datasourceName: string; datasourceXml: string; columnsXml: string[] }
            | undefined;
          let targetDatasource: DatasourceElement | undefined;
          let resolvedFields: ResolvedFilterField[] | undefined;
          let filterLinkExpression: string | undefined;
          let filterAction: FilterAction | undefined;
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
          if (mode === 'filter') {
            filterAction = {
              target: effectiveTargetSheet,
              sourceWorksheet: effectiveSourceSheet,
              sourceDashboard: effectiveSourceDashboard,
              sourceExcludeSheets: effectiveExcludedSourceSheets,
              activation,
              autoClear: clearSelection !== 'do-nothing',
              targetExcludeSheets:
                effectiveExcludedTargetSheets.length > 0
                  ? effectiveExcludedTargetSheets.join(',')
                  : undefined,
              onEmpty: clearSelection === 'exclude-all',
              singleSelect: singleSelect === true,
              linkExpression: filterLinkExpression,
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
          if (mode === 'filter' && hasFilterActionDuplicate(liveXml, filterAction!)) {
            return new ArgsValidationError(
              'an identical filter action (same source, target, fields, and behavior) already exists',
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
              excludeSourceSheets: effectiveExcludedSourceSheets,
              url: target,
              urlTarget: urlTarget ?? 'default-zone-or-browser',
              zoneId: zoneId?.trim() ?? '',
              urlEncode: urlEncode ?? false,
              activation,
            });
          } else if (mode === 'filter') {
            target = filterAction!.target;
            actionXml = renderFilterAction(caption, actionName, filterAction!);
          } else {
            // Emit the internal token resolved during the existence check above, not the raw
            // input, so a caption argument serializes as the [Parameters].[Parameter N] Tableau
            // can actually resolve. Readback below compares against this same `target`.
            target = resolvedTargetParameter;
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
              // Verify every semantic renderFilterAction serialized, not just the target, so the
              // receipt does not report a dropped setting as applied. Same object we authored from.
              // For a specific-field filter also confirm the sibling <datasources>/
              // <datasource-dependencies> survived — without them the <link> resolves no fields.
              return (
                hasFilterAction(xml, caption, filterAction!) &&
                hasFilterDependencies(xml, filterDependencies)
              );
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
                    ? 'action applied but did not survive readback with the requested filter semantics (the tsl-filter target/link, source scope, activation, clearing behavior, exclusions, single-select, or the field datasource/dependency declarations may have been dropped or rewritten)'
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
              hasSourceWorksheet ? `worksheet '${effectiveSourceSheet}'` : '',
              hasSourceDashboard ? `dashboard '${effectiveSourceDashboard}'` : '',
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
              excludeSourceSheets: effectiveExcludedSourceSheets,
              excludeTargetSheets: effectiveExcludedTargetSheets,
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

function validateExcludedSheets(
  liveXml: string,
  worksheetNames: Set<string>,
  dashboardName: string,
  excludedSheets: string[],
  message: string,
): ArgsValidationError | undefined {
  if (excludedSheets.length === 0) {
    return undefined;
  }
  // Verify that the dashboard name is actually a dashboard.
  if (worksheetNames.has(dashboardName)) {
    return new ArgsValidationError(
      `'${dashboardName}' is a worksheet, not a dashboard. ${message}`,
    );
  }
  // An exclusion can only drop a worksheet zone from the dashboard, so verify the dashboard has worksheet zones
  const zoneNames = findDashboardZoneNames(liveXml, dashboardName);
  const members =
    zoneNames === undefined ? [] : [...zoneNames].filter((name) => worksheetNames.has(name));
  if (members.length === 0) {
    return new ArgsValidationError(
      `dashboard "${dashboardName}" has no worksheet zones, so there are no sheets to exclude. ${message}`,
    );
  }
  // Verify every excluded sheet is a worksheet on the dashboard.
  const invalidExcludedSheets = excludedSheets.filter((name) => !members.includes(name));
  if (invalidExcludedSheets.length > 0) {
    const invalidSheetList =
      invalidExcludedSheets.length > 1
        ? `excluded sheets ${invalidExcludedSheets.join(', ')} are`
        : `excluded sheet ${invalidExcludedSheets[0]} is`;
    return new ArgsValidationError(
      `${invalidSheetList} not on dashboard "${dashboardName}". Worksheets on "${dashboardName}": ${members.join(', ')}. ${message}`,
    );
  }
  return undefined;
}

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

// Emit <source> attributes type-first (type, worksheet, dashboard)
function renderSourceAttrs(sourceWorksheet: string, sourceDashboard: string): string {
  return (
    " type='sheet'" +
    (sourceWorksheet.length > 0 ? ` worksheet='${escapeXml(sourceWorksheet)}'` : '') +
    (sourceDashboard.length > 0 ? ` dashboard='${escapeXml(sourceDashboard)}'` : '')
  );
}

// Serialize the whole <source> element. Source-sheet opt-outs (<exclude-sheet> children) narrow
// which sheets on a dashboard source fire the action; they open/close the element, otherwise it
// self-closes. Shared by url and filter modes so the two paths emit identical source XML.
function renderSourceElement(
  sourceWorksheet: string,
  sourceDashboard: string,
  excludeSourceSheets: string[],
): string {
  const attrs = renderSourceAttrs(sourceWorksheet, sourceDashboard);
  const excludeChildren = excludeSourceSheets
    .filter((sheet) => sheet.length > 0)
    .map((sheet) => `<exclude-sheet name='${escapeXml(sheet)}' />`)
    .join('');
  return excludeChildren.length > 0
    ? `<source${attrs}>${excludeChildren}</source>`
    : `<source${attrs} />`;
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

// Collect the name attributes of every <elementTag> inside the first <blockTag> container,
// e.g. worksheet names in <worksheets>, dashboard names in <dashboards>, or zone names in a
// dashboard's <zones>. Empty set when the container is absent.
function findElementNames(xml: string, blockTag: string, elementTag: string): Set<string> {
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

// Resolve the zones declared on a dashboard, returning the set of every <zone> name attribute
// inside the dashboard's <zones> block.
function findDashboardZoneNames(xml: string, dashboardName: string): Set<string> | undefined {
  const blockStart = xml.indexOf('<dashboards>');
  if (blockStart === -1) {
    return undefined;
  }
  const blockEnd = xml.indexOf('</dashboards>', blockStart);
  const dashboardsBlock = xml.slice(blockStart, blockEnd === -1 ? xml.length : blockEnd);

  // The (?=\s) lookahead keeps the plural <dashboards> container from matching.
  for (const match of dashboardsBlock.matchAll(/<dashboard(?=\s)[^>]*>/g)) {
    const openTag = match[0];
    if (unescapeXml(getAttr(openTag, 'name') ?? '') !== dashboardName) {
      continue;
    }
    if (openTag.endsWith('/>')) {
      return undefined;
    }
    const contentStart = (match.index ?? 0) + openTag.length;
    const contentEnd = dashboardsBlock.indexOf('</dashboard>', contentStart);
    const content = dashboardsBlock.slice(
      contentStart,
      contentEnd === -1 ? dashboardsBlock.length : contentEnd,
    );
    if (content.indexOf('<zones>') === -1) {
      return undefined;
    }
    return findElementNames(content, 'zones', 'zone');
  }
  return undefined;
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

// Enumerate the fields a parameter action could read its source value from, for the sourceField
// recovery message. summarizeSchema already excludes the Parameters datasource, so this lists only
// real data fields. Each entry pairs the friendly name with the bracketed column name the caller
// passes as sourceField, e.g. "Profit ([Profit])". "none" when the workbook exposes no fields.
function formatAvailableFields(liveXml: string): string {
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const field of summarizeSchema(liveXml).fields) {
    if (seen.has(field.columnName)) {
      continue;
    }
    seen.add(field.columnName);
    const friendly = field.caption ?? bareName(field.columnName);
    entries.push(`${friendly} (${field.columnName})`);
  }
  return entries.length > 0 ? entries.join(', ') : 'none';
}

// Enumerate the parameters already in the workbook, for the targetParameter recovery message.
// findWorkbookParameters reads the Parameters datasource (the field summary excludes it). Each
// entry pairs the caption with the fully qualified token the caller passes as targetParameter,
// e.g. "p.Period ([Parameters].[Parameter 1])". "none" when the workbook has no parameters yet.
function formatAvailableParameters(liveXml: string): string {
  const entries = findWorkbookParameters(liveXml).map(
    (parameter) =>
      `${parameter.caption ?? parameter.name} ([Parameters].${bracketToken(parameter.name)})`,
  );
  return entries.length > 0 ? entries.join(', ') : 'none';
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
  excludeSourceSheets,
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
  excludeSourceSheets: string[];
  url: string;
  urlTarget: z.infer<typeof urlTargetSchema>;
  zoneId: string;
  urlEncode: boolean;
  activation: z.infer<typeof activationSchema>;
}): string {
  const sourceXml = renderSourceElement(sourceWorksheet, sourceDashboard, excludeSourceSheets);

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

// Percent-encode strings so only RFC 3986 unreserved chars (alnum and - . _ ~)
// stay literal. encodeURIComponent also leaves ! * ' ( ) alone, so encode those too.
function tslUrlEscape(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

// Build the raw tsl: sheet-link expression for a specific-field filter.
// Each field adds a clause
// `urlEscape([ds].[field]~s0)=<[ds].[field]~na>`, joined with '&'. The two sides escape differently:
//   left  (~s0): TUrl::URLEscape — every reserved char (including [ ] < > & %) becomes %XX.
//   right (~na): angle-bracket doubling only ('<'->'<<', '>'->'>>') wrapped in one <…>; '&', '%', '~',
//                '[' and ']' stay raw
// The caller XML-escapes the whole result into the <link expression> attribute.
function buildTslExpression(target: string, datasourceName: string, columnNames: string[]): string {
  const clauses = columnNames.map((columnName) => {
    const locator = `[${datasourceName}].${columnName}`;
    const source = `${locator}~na`.replaceAll('<', '<<').replaceAll('>', '>>');
    return `${tslUrlEscape(`${locator}~s0`)}=<${source}>`;
  });
  return `tsl:${tslUrlEscape(target)}?${clauses.join('&')}`;
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
//   All Fields (no linkExpression) -> a lone <command> with special-fields='all'.
//   Specific fields (linkExpression set) -> a tsl: <link> of field locators plus a <command> keeping
//     only the target param, with the fields declared in sibling <datasources>/<datasource-dependencies>
//     blocks (see spliceActionIntoWorkbook's deps handling).
function renderFilterAction(caption: string, actionName: string, action: FilterAction): string {
  const activationXml = renderActivation(action.activation, action.autoClear);

  const sourceXml = renderSourceElement(
    action.sourceWorksheet,
    action.sourceDashboard,
    action.sourceExcludeSheets,
  );

  // A specific-field filter carries its resolved field locators in a tsl: <link> that precedes the
  // <command>; an all-fields filter has no link and sets special-fields='all' on the command.
  const linkXml =
    action.linkExpression !== undefined
      ? `<link caption='${escapeXml(caption)}' delimiter=',' escape='\\' expression='${escapeXml(
          action.linkExpression,
        )}' include-null='true' multi-select='true' url-escape='true' />`
      : '';

  const params: string[] = [];
  if (action.targetExcludeSheets !== undefined) {
    params.push(`<param name='exclude' value='${escapeXml(action.targetExcludeSheets)}' />`);
  }
  if (action.onEmpty) {
    params.push("<param name='on-empty' value='none' />");
  }
  if (action.singleSelect) {
    params.push("<param name='single-select' value='' />");
  }
  if (action.linkExpression === undefined) {
    params.push("<param name='special-fields' value='all' />");
  }
  params.push(`<param name='target' value='${escapeXml(action.target)}' />`);

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

// The shape of a filter action
type FilterAction = {
  target: string;
  sourceWorksheet: string;
  sourceDashboard: string;
  // Source-sheet opt-outs: <exclude-sheet> children of <source>, narrowing which sheets on a
  // dashboard source fire the action.
  sourceExcludeSheets: string[];
  activation: z.infer<typeof activationSchema>;
  autoClear: boolean;
  // Target-sheet opt-outs: the comma-joined command `exclude` param on <target>, narrowing which sheets a
  // dashboard target filters.
  targetExcludeSheets?: string;
  onEmpty: boolean;
  singleSelect: boolean;
  linkExpression?: string;
};

// The <exclude-sheet> opt-out names inside a block's <source> element (source-sheet exclusions).
// A self-closed <source ... /> has no children, so the open/close regex fails to match and this
// returns []. Names are compared order-independently, so callers use sameSheetSet.
function buildSourceExcludeSheetNames(block: string): string[] {
  const sourceMatch = block.match(/<source\b[^>]*>([\s\S]*?)<\/source>/);
  if (sourceMatch === null) {
    return [];
  }
  return [...sourceMatch[1].matchAll(/<exclude-sheet\b[^>]*>/g)]
    .map((tag) => unescapeXml(getAttr(tag[0], 'name') ?? ''))
    .filter((name) => name.length > 0);
}

// Order-independent equality for sheet-name lists (Tableau may re-order children on save).
function isSameSheetSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}

// Split a comma-joined sheet list (the command `exclude` param value = target-sheet exclusions)
// into trimmed names, dropping empties. undefined/absent -> []. Lets target exclusions compare as
// a set, so Tableau re-ordering the comma list on save does not fail readback.
function splitSheetList(value: string | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  return value
    .split(',')
    .map((sheet) => sheet.trim())
    .filter((sheet) => sheet.length > 0);
}

// True when an <action> block is the filter action described by `expected`
function filterActionMatches(block: string, expected: FilterAction): boolean {
  const commandTag = block.match(/<command\b[^>]*>/)?.[0];
  if (commandTag === undefined || getAttr(commandTag, 'command') !== 'tsc:tsl-filter') {
    return false;
  }

  const sourceTag = block.match(/<source\b[^>]*>/)?.[0];
  const sourceWorksheet =
    sourceTag === undefined ? '' : unescapeXml(getAttr(sourceTag, 'worksheet') ?? '');
  const sourceDashboard =
    sourceTag === undefined ? '' : unescapeXml(getAttr(sourceTag, 'dashboard') ?? '');
  const sourceExcludeSheets = buildSourceExcludeSheetNames(block);
  const expectedType = expected.activation === 'on-menu' ? undefined : expected.activation;
  const activationTag = block.match(/<activation\b[^>]*>/)?.[0];
  const activationType = activationTag === undefined ? undefined : getAttr(activationTag, 'type');
  const autoClear = activationTag !== undefined && getAttr(activationTag, 'auto-clear') === 'true';

  // Command params, keyed by name so presence/value checks ignore serialized order.
  const params = new Map<string, string>();
  for (const paramMatch of block.matchAll(/<param\b[^>]*>/g)) {
    const name = getAttr(paramMatch[0], 'name');
    if (name !== undefined) {
      params.set(name, unescapeXml(getAttr(paramMatch[0], 'value') ?? ''));
    }
  }
  const filterByAllFields = params.get('special-fields') === 'all';
  if (
    sourceWorksheet !== expected.sourceWorksheet ||
    sourceDashboard !== expected.sourceDashboard ||
    !isSameSheetSet(sourceExcludeSheets, expected.sourceExcludeSheets) ||
    activationType !== expectedType ||
    autoClear !== expected.autoClear ||
    params.get('target') !== expected.target ||
    !isSameSheetSet(
      splitSheetList(params.get('exclude')),
      splitSheetList(expected.targetExcludeSheets),
    ) ||
    (params.get('on-empty') === 'none') !== expected.onEmpty ||
    params.has('single-select') !== expected.singleSelect ||
    filterByAllFields !== (expected.linkExpression === undefined)
  ) {
    return false;
  }

  // columns are verified by comparing the link expressions
  if (expected.linkExpression !== undefined) {
    const linkTag = block.match(/<link\b[^>]*>/)?.[0];
    const expression = linkTag === undefined ? undefined : getAttr(linkTag, 'expression');
    if (expression === undefined || unescapeXml(expression) !== expected.linkExpression) {
      return false;
    }
  }
  return true;
}

// Readback predicate for filter mode: the caption-matched <action> must be the one we authored,
// so every setting the receipt echoes is verified rather than assumed. Any dropped or rewritten
// setting means it is not our action.
function hasFilterAction(xml: string, caption: string, expected: FilterAction): boolean {
  return [...xml.matchAll(/<action\b[^>]*>[\s\S]*?<\/action>/g)].some((match) => {
    const block = match[0];
    const openingTag = block.match(/^<action\b[^>]*>/)?.[0];
    if (openingTag === undefined || unescapeXml(getAttr(openingTag, 'caption') ?? '') !== caption) {
      return false;
    }
    return filterActionMatches(block, expected);
  });
}

// Dedup guard: the document-apply path appends, so an identical filter action authored under a
// different caption would silently double.
function hasFilterActionDuplicate(xml: string, expected: FilterAction): boolean {
  return [...xml.matchAll(/<action\b[^>]*>[\s\S]*?<\/action>/g)].some((match) =>
    filterActionMatches(match[0], expected),
  );
}

// A specific-field filter resolves its fields through the sibling <datasources> entry and
// <datasource-dependencies> columns. The <link> expression alone does nothing without them.
// Return true if the given xml contains the given list of datasource columns
function hasFilterDependencies(
  xml: string,
  deps: { datasourceName: string; columnsXml: string[] } | undefined,
): boolean {
  if (deps === undefined || deps.columnsXml.length === 0) {
    return true;
  }
  const actionsBlock = xml.match(/<actions>[\s\S]*?<\/actions>/)?.[0];
  if (actionsBlock === undefined) {
    return false;
  }
  // The datasource must still be listed in the action-scoped <datasources> block.
  const datasourcesBlock = actionsBlock.match(/<datasources>[\s\S]*?<\/datasources>/)?.[0];
  const datasourceListed =
    datasourcesBlock !== undefined &&
    [...datasourcesBlock.matchAll(/<datasource\b[^>]*>/g)].some(
      (match) => unescapeXml(getAttr(match[0], 'name') ?? '') === deps.datasourceName,
    );
  if (!datasourceListed) {
    return false;
  }
  // Its <datasource-dependencies> block must still declare every resolved column.
  const dependencyBlock = [
    ...actionsBlock.matchAll(
      /<datasource-dependencies\b[^>]*>[\s\S]*?<\/datasource-dependencies>/g,
    ),
  ]
    .map((match) => match[0])
    .find((block) => {
      const openTag = block.match(/<datasource-dependencies\b[^>]*>/)?.[0];
      return (
        openTag !== undefined &&
        unescapeXml(getAttr(openTag, 'datasource') ?? '') === deps.datasourceName
      );
    });
  if (dependencyBlock === undefined) {
    return false;
  }
  const declaredColumns = new Set(
    [...dependencyBlock.matchAll(/<column\b[^>]*>/g)].map((match) =>
      unescapeXml(getAttr(match[0], 'name') ?? ''),
    ),
  );
  return deps.columnsXml.every((column) => {
    const name = unescapeXml(getAttr(column.match(/<column\b[^>]*>/)?.[0] ?? '', 'name') ?? '');
    return declaredColumns.has(name);
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

// Anchor the attribute name on a preceding delimiter (start-of-string, whitespace, or quote) rather
// than a \b word boundary: \b also matches between a hyphen/colon and a letter, so a decoy like
// param-name='A' would satisfy \bname= and win over the real name='B'. Exported for unit testing.
export function getAttr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`(?:^|[\\s"'])${name}=(['"])(.*?)\\1`));
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
