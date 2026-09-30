import { DOMParser } from '@xmldom/xmldom';
import { Err, Ok, type Result } from 'ts-results-es';

import { bindExplicitTemplate, formatExplicitBindErrors } from '../binder/explicit-bind.js';
import type { Derivation } from '../binder/manifest-types.js';
import { summarizeSchema } from '../binder/schema-summary.js';
import { resolveUniqueDatasourceName } from '../field-resolver.js';
import { planTopN } from '../refine/refineWorksheet.js';
import { extractSheetXml, extractWorksheetWindowXml } from '../sheets.js';
import { normalizeBookmarkXml } from './bookmarkTemplate.js';
import { buildInjectedWorkbookXml } from './injectTemplateCore.js';
import { createTemplateRuntimeSnapshot } from './templateRuntimeSnapshot.js';

export const MAX_TEMPLATE_BINDINGS = 32;

export interface WorksheetTemplatePlan {
  templateName: string;
  title: string;
  datasource: string;
  fieldMapping: Record<string, string>;
  derivationOverrides?: Record<string, Derivation>;
  topN?: number;
}

export interface BuiltWorksheetXml {
  worksheetXml: string;
  windowXml: string;
  datasource: string;
  fieldMapping: Record<string, string>;
  templateSourceHash: string;
  bindings: Array<{ slotId: string; field: string }>;
  warnings: string[];
}

export type BuildWorksheetXmlError =
  | { kind: 'args'; message: string }
  | { kind: 'xml'; message: string; issues: string[] }
  | { kind: 'generation'; message: string };

function validateInputXml(
  xml: string,
  expectedRoot: 'workbook' | 'bookmark',
): BuildWorksheetXmlError | null {
  let invalid = false;
  try {
    const document = new DOMParser({
      onError: (level) => {
        if (level !== 'warning') invalid = true;
      },
    }).parseFromString(expectedRoot === 'bookmark' ? normalizeBookmarkXml(xml) : xml, 'text/xml');
    if (invalid || document.documentElement?.tagName !== expectedRoot) {
      const message = `${expectedRoot} XML must be well-formed with a <${expectedRoot}> root.`;
      return { kind: 'xml', message, issues: [message] };
    }
    if (expectedRoot === 'bookmark' && document.getElementsByTagName('table').length === 0) {
      const message = 'bookmark XML must contain a <table> element.';
      return { kind: 'xml', message, issues: [message] };
    }
    return null;
  } catch (error) {
    const message = `${expectedRoot} XML is not well-formed: ${error instanceof Error ? error.message : String(error)}`;
    return { kind: 'xml', message, issues: [message] };
  }
}

function datasourceNamesAreEquivalent(
  requested: string,
  bound: string,
  workbookDatasourceNames: ReadonlySet<string>,
): boolean {
  const normalizedRequested = requested.normalize('NFC');
  const normalizedBound = bound.normalize('NFC');
  if (normalizedRequested === normalizedBound) return true;

  const [raw, unwrapped] =
    normalizedRequested.startsWith('[') && normalizedRequested.endsWith(']')
      ? [normalizedRequested, normalizedRequested.slice(1, -1)]
      : normalizedBound.startsWith('[') && normalizedBound.endsWith(']')
        ? [normalizedBound, normalizedBound.slice(1, -1)]
        : [undefined, undefined];
  if (raw === undefined || unwrapped === undefined) return false;
  if (unwrapped !== normalizedRequested && unwrapped !== normalizedBound) return false;

  const normalizedWorkbookNames = new Set(
    [...workbookDatasourceNames].map((name) => name.normalize('NFC')),
  );
  return !(normalizedWorkbookNames.has(raw) && normalizedWorkbookNames.has(unwrapped));
}

export function buildWorksheetXml({
  workbookXml,
  templateXml,
  plan,
  nonce,
}: {
  workbookXml: string;
  templateXml: string;
  plan: WorksheetTemplatePlan;
  nonce: string;
}): Result<BuiltWorksheetXml, BuildWorksheetXmlError> {
  if (!nonce.trim()) return Err({ kind: 'args', message: 'nonce must be nonempty.' });
  const bindingEntries = Object.entries(plan.fieldMapping);
  if (bindingEntries.length === 0 || bindingEntries.length > MAX_TEMPLATE_BINDINGS) {
    return Err({
      kind: 'args',
      message: `fieldMapping must contain 1-${MAX_TEMPLATE_BINDINGS} template slot bindings.`,
    });
  }

  const workbookIssue = validateInputXml(workbookXml, 'workbook');
  if (workbookIssue) return Err(workbookIssue);
  const templateIssue = validateInputXml(templateXml, 'bookmark');
  if (templateIssue) return Err(templateIssue);

  try {
    const snapshot = createTemplateRuntimeSnapshot(plan.templateName, templateXml);
    if (!snapshot.eligibility.pass1_eligible) {
      return Err({
        kind: 'args',
        message: `Template "${plan.templateName}" is not eligible for worksheet template application.`,
      });
    }

    const schema = summarizeSchema(workbookXml);
    const workbookDatasourceNames = new Set(schema.fields.map((field) => field.datasource));
    const resolvedPlanDatasource = resolveUniqueDatasourceName(workbookXml, plan.datasource);
    if (resolvedPlanDatasource === null) {
      return Err({
        kind: 'args',
        message: `Datasource "${plan.datasource}" is not a unique workbook datasource name or caption.`,
      });
    }
    const explicitBind = bindExplicitTemplate(plan.templateName, plan.fieldMapping, schema, {
      contract: snapshot.descriptor,
      title: plan.title,
      datasource: resolvedPlanDatasource,
      derivationOverrides: plan.derivationOverrides,
    });
    if (!explicitBind.ok) {
      return Err({
        kind: 'args',
        message: formatExplicitBindErrors(plan.templateName, explicitBind.errors),
      });
    }
    if (
      !datasourceNamesAreEquivalent(
        resolvedPlanDatasource,
        explicitBind.datasource,
        workbookDatasourceNames,
      )
    ) {
      return Err({
        kind: 'args',
        message: `Datasource "${plan.datasource}" does not match the bound datasource "${explicitBind.datasource}".`,
      });
    }

    const injected = buildInjectedWorkbookXml({
      workbookXml,
      templateXml: snapshot.xml,
      title: plan.title,
      sheetType: 'worksheet',
      templateParameters: { DATASOURCE: explicitBind.datasource },
      fieldMapping: explicitBind.fieldMapping,
      templateSlots: explicitBind.templateSlots,
      fieldMetadata: explicitBind.fieldMetadata,
      applyNonce: nonce,
      optionalFieldPrunes: explicitBind.optionalFieldPrunes,
    });
    if (!injected.ok) {
      return Err({ kind: 'xml', message: injected.issues.join('; '), issues: injected.issues });
    }

    let worksheetXml = extractSheetXml(injected.xml, plan.title);
    const windowXml = extractWorksheetWindowXml(injected.xml, plan.title);
    if (!worksheetXml || !windowXml) {
      return Err({
        kind: 'args',
        message: `Template "${plan.templateName}" did not produce a complete worksheet artifact.`,
      });
    }
    if (plan.topN !== undefined) {
      const bounded = planTopN(worksheetXml, { n: plan.topN });
      if (!bounded.ok) {
        return Err({
          kind: 'args',
          message: `topN could not be applied to template "${plan.templateName}": ${bounded.reason}`,
        });
      }
      worksheetXml = bounded.xml;
    }

    return Ok({
      worksheetXml,
      windowXml,
      datasource: explicitBind.datasource,
      fieldMapping: explicitBind.fieldMapping,
      templateSourceHash: snapshot.sourceHash,
      bindings: explicitBind.templateSlots
        .map((slot) => {
          const mappingKey = slot.qualified_key_required
            ? `${slot.template_field}@${slot.derivation}`
            : slot.template_field;
          return { slotId: slot.slot_id, field: explicitBind.fieldMapping[mappingKey] };
        })
        .filter(
          (binding): binding is { slotId: string; field: string } => binding.field !== undefined,
        ),
      warnings: [...explicitBind.warnings, ...(injected.warnings ?? [])],
    });
  } catch (error) {
    return Err({
      kind: 'generation',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
