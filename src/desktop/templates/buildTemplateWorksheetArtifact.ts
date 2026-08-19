import { Ok, type Result } from 'ts-results-es';

import {
  ArgsValidationError,
  FileReadError,
  McpToolError,
  XmlValidationError,
} from '../../errors/mcpToolError.js';
import { bindExplicitTemplate, formatExplicitBindErrors } from '../binder/explicit-bind.js';
import { summarizeSchema } from '../binder/schema-summary.js';
import { extractSheetXml, extractWorksheetWindowXml } from '../metadata/sheets.js';
import { captureTargetWorksheetState } from '../metadata/targetWorksheetState.js';
import { buildInjectedWorkbookXml } from './injectTemplateCore.js';
import type { TemplateWorksheetArtifact } from './templateArtifactStore.js';
import { getTemplateCatalogEntry, readBookmarkFromCatalogEntry } from './templatePath.js';
import { createTemplateRuntimeSnapshot } from './templateRuntimeSnapshot.js';

export const MAX_TEMPLATE_BINDINGS = 32;

function normalizeDatasourceName(name: string): string {
  const normalized = name.normalize('NFC').trim();
  const unwrapped =
    normalized.startsWith('[') && normalized.endsWith(']') ? normalized.slice(1, -1) : normalized;
  return unwrapped.trim().toLocaleLowerCase();
}

export interface WorksheetTemplatePlan {
  templateName: string;
  title: string;
  datasource: string;
  fieldMapping: Record<string, string>;
}

export interface BuiltTemplateWorksheetArtifact {
  artifact: TemplateWorksheetArtifact;
  provenance: string;
  bindings: Array<{ slotId: string; field: string }>;
}

export function buildTemplateWorksheetArtifact({
  artifactId,
  sessionId,
  instanceId,
  workbookXml,
  plan,
}: {
  artifactId: string;
  sessionId: string;
  instanceId: string;
  workbookXml: string;
  plan: WorksheetTemplatePlan;
}): Result<BuiltTemplateWorksheetArtifact, McpToolError> {
  const bindingEntries = Object.entries(plan.fieldMapping);
  if (bindingEntries.length === 0 || bindingEntries.length > MAX_TEMPLATE_BINDINGS) {
    return new ArgsValidationError(
      `fieldMapping must contain 1-${MAX_TEMPLATE_BINDINGS} template slot bindings.`,
    ).toErr();
  }

  let entry;
  try {
    entry = getTemplateCatalogEntry(plan.templateName);
  } catch (error) {
    return new ArgsValidationError(error instanceof Error ? error.message : String(error)).toErr();
  }
  if (!entry || entry.discoveryIssue) {
    return new ArgsValidationError(`Template "${plan.templateName}" is not available.`).toErr();
  }

  const bookmarkXml = readBookmarkFromCatalogEntry(entry);
  if (bookmarkXml === null) {
    return new ArgsValidationError(`Template "${plan.templateName}" could not be read.`).toErr();
  }

  try {
    const snapshot = createTemplateRuntimeSnapshot(plan.templateName, bookmarkXml);
    if (!snapshot.eligibility.pass1_eligible) {
      return new ArgsValidationError(
        `Template "${plan.templateName}" is not eligible for worksheet template application.`,
      ).toErr();
    }

    const explicitBind = bindExplicitTemplate(
      plan.templateName,
      plan.fieldMapping,
      summarizeSchema(workbookXml),
      {
        contract: snapshot.descriptor,
        title: plan.title,
        datasource: plan.datasource,
      },
    );
    if (!explicitBind.ok) {
      return new ArgsValidationError(
        formatExplicitBindErrors(plan.templateName, explicitBind.errors),
      ).toErr();
    }
    if (
      normalizeDatasourceName(explicitBind.datasource) !== normalizeDatasourceName(plan.datasource)
    ) {
      return new ArgsValidationError(
        `Datasource "${plan.datasource}" does not match the bound datasource "${explicitBind.datasource}".`,
      ).toErr();
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
      applyNonce: artifactId,
      optionalFieldPrunes: explicitBind.optionalFieldPrunes,
    });
    if (!injected.ok) return new XmlValidationError(injected.issues).toErr();

    const worksheetXml = extractSheetXml(injected.xml, plan.title);
    const windowXml = extractWorksheetWindowXml(injected.xml, plan.title);
    if (!worksheetXml || !windowXml) {
      return new ArgsValidationError(
        `Template "${plan.templateName}" did not produce a complete worksheet artifact.`,
      ).toErr();
    }

    return Ok({
      artifact: {
        id: artifactId,
        sessionId,
        instanceId,
        templateName: plan.templateName,
        templateSourceHash: snapshot.sourceHash,
        title: plan.title,
        datasource: explicitBind.datasource,
        fieldMapping: explicitBind.fieldMapping,
        worksheetXml,
        windowXml,
        targetState: captureTargetWorksheetState(workbookXml, plan.title, worksheetXml),
      },
      provenance: entry.provenance,
      bindings: explicitBind.templateSlots
        .map((slot) => {
          const mappingKey = slot.qualified_key_required
            ? `${slot.template_field}@${slot.derivation}`
            : slot.template_field;
          return {
            slotId: slot.slot_id,
            field: explicitBind.fieldMapping[mappingKey],
          };
        })
        .filter(
          (binding): binding is { slotId: string; field: string } => binding.field !== undefined,
        ),
    });
  } catch (error) {
    return new FileReadError(error).toErr();
  }
}
