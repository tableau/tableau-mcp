import { randomBytes } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { isAbsolute, resolve } from 'path';
import { Ok, Result } from 'ts-results-es';

import { McpToolError } from '../errors/mcpToolError.js';
import { deriveIdentity } from '../tools/web/scaffoldDataApp/templateIdentity.js';
import { slugDataAppName } from './dataAppName.js';
import {
  containedPath,
  copyPackageTree,
  escapeXml,
  replaceLiteral,
  replaceTokensInTree,
  unzippedPackageSrcUrl,
} from './packageFiles.js';

export type LiveDatasource = { id?: string; name?: string };

export type PreparedDesktopDataApp = {
  packageId: string;
  sourceDir: string;
  worksheetFile: string;
  datasourceId: string;
  worksheetName: string;
};

function extensionsDatasourceId(
  datasourceId: string,
  datasources: LiveDatasource[],
): Result<string, McpToolError> {
  const matches = datasources.filter((datasource) => datasource.id === datasourceId);
  if (matches.length !== 1 || !matches[0].name) {
    const available = datasources
      .filter((datasource) => datasource.id && datasource.name)
      .map((datasource) => `${datasource.id} (${datasource.name})`);
    return new McpToolError({
      type: 'datasource-not-selected',
      message:
        `Select one live datasource by its External API id. Requested "${datasourceId}". ` +
        `Available: ${available.length ? available.join(', ') : '(none)'}.`,
      statusCode: 400,
    }).toErr();
  }
  return new Ok(matches[0].name);
}

function worksheetXml(args: {
  worksheetName: string;
  packageId: string;
  version: string;
  sourceDir: string;
  extensionsDatasourceId: string;
}): string {
  const name = escapeXml(args.worksheetName);
  const datasource = escapeXml(args.extensionsDatasourceId);
  const url = escapeXml(unzippedPackageSrcUrl(args.sourceDir));
  const instanceId = randomBytes(16).toString('hex').toUpperCase();
  return (
    `<worksheet name='${name}'>` +
    `<table><view><datasources><datasource name='${datasource}' /></datasources>` +
    "<aggregation value='true' /></view><style />" +
    "<panes><pane><view><breakdown value='auto' /></view>" +
    "<mark class='VizExtension' />" +
    `<add-in add-in-id='${escapeXml(args.packageId)}' extension-url='${url}' extension-version='${escapeXml(args.version)}' instance-id='${instanceId}'>` +
    '<instance-settings /><type-settings><worksheet /></type-settings></add-in>' +
    '</pane></panes><rows /><cols /></table></worksheet>'
  );
}

export async function prepareDesktopDataApp(args: {
  workspaceRoot: string;
  worksheetFile: string;
  templatePackageDir: string;
  datappName: string;
  datasourceId: string;
  datasources: LiveDatasource[];
}): Promise<Result<PreparedDesktopDataApp, McpToolError>> {
  if (!isAbsolute(args.workspaceRoot)) {
    return new McpToolError({
      type: 'data-app-workspace-unconfigured',
      message:
        'Set TABLEAU_DATA_APP_WORKSPACE_DIR to an absolute directory before scaffolding a Desktop data app.',
      statusCode: 400,
    }).toErr();
  }

  const selected = extensionsDatasourceId(args.datasourceId, args.datasources);
  if (selected.isErr()) {
    return selected;
  }

  const identity = deriveIdentity(args.datappName);
  const suffix = randomBytes(4).toString('hex');
  const packageId = `${identity.packageId}.${suffix}`;
  let sourceDir: string;
  try {
    sourceDir = containedPath(
      args.workspaceRoot,
      resolve(args.workspaceRoot, `${slugDataAppName(args.datappName)}-${suffix}`),
    );
  } catch {
    return new McpToolError({
      type: 'data-app-path-rejected',
      message: 'Refusing to scaffold outside the data app workspace.',
      statusCode: 400,
    }).toErr();
  }

  await mkdir(args.workspaceRoot, { recursive: true });
  await copyPackageTree(args.templatePackageDir, sourceDir);
  await replaceTokensInTree(sourceDir, (relativePath, text) => {
    const display = relativePath.endsWith('.json')
      ? JSON.stringify(identity.displayName).slice(1, -1)
      : escapeXml(identity.displayName);
    return replaceLiteral(
      replaceLiteral(
        replaceLiteral(
          replaceLiteral(
            replaceLiteral(text, 'TODO-MANIFEST-ID', packageId),
            'TODO-MANIFEST-VERSION',
            identity.version,
          ),
          'TODO Author Name',
          'Tableau MCP',
        ),
        'TODO App Name',
        display,
      ),
      "var BOUND_DATASOURCE_ID = '';",
      `var BOUND_DATASOURCE_ID = ${JSON.stringify(selected.value)};`,
    );
  });

  const xml = worksheetXml({
    worksheetName: identity.displayName,
    packageId,
    version: identity.version,
    sourceDir,
    extensionsDatasourceId: selected.value,
  });
  await mkdir(resolve(args.worksheetFile, '..'), { recursive: true });
  await writeFile(args.worksheetFile, xml, 'utf8');

  return new Ok({
    packageId,
    sourceDir,
    worksheetFile: args.worksheetFile,
    datasourceId: selected.value,
    worksheetName: identity.displayName,
  });
}
