import { Ok, type Result } from 'ts-results-es';

import {
  ArgsValidationError,
  FileReadError,
  McpToolError,
  XmlValidationError,
} from '../../errors/mcpToolError.js';
import { captureTargetWorksheetState } from '../../metadata/targetWorksheetState.js';
import {
  buildWorksheetXml,
  type BuildWorksheetXmlError,
  type WorksheetTemplatePlan,
} from '../../metadata/templates/buildWorksheetXml.js';
import type { TemplateWorksheetArtifact } from './templateArtifactStore.js';
import { getTemplateCatalogEntry, readBookmarkFromCatalogEntry } from './templatePath.js';

export interface BuiltTemplateWorksheetArtifact {
  artifact: TemplateWorksheetArtifact;
  provenance: string;
  bindings: Array<{ slotId: string; field: string }>;
}

function asMcpError(error: BuildWorksheetXmlError): McpToolError {
  switch (error.kind) {
    case 'args':
      return new ArgsValidationError(error.message);
    case 'xml':
      return new XmlValidationError(error.issues);
    case 'generation':
      return new FileReadError(new Error(error.message));
  }
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

  const built = buildWorksheetXml({
    workbookXml,
    templateXml: bookmarkXml,
    plan,
    nonce: artifactId,
  });
  if (built.isErr()) return asMcpError(built.error).toErr();

  try {
    return Ok({
      artifact: {
        id: artifactId,
        sessionId,
        instanceId,
        templateName: plan.templateName,
        templateSourceHash: built.value.templateSourceHash,
        title: plan.title,
        datasource: built.value.datasource,
        fieldMapping: built.value.fieldMapping,
        worksheetXml: built.value.worksheetXml,
        windowXml: built.value.windowXml,
        targetState: captureTargetWorksheetState(workbookXml, plan.title, built.value.worksheetXml),
      },
      provenance: entry.provenance,
      bindings: built.value.bindings,
    });
  } catch (error) {
    return new FileReadError(error).toErr();
  }
}
