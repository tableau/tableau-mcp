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

export type LiveDatasource = { id?: string; name?: string; caption?: string };

export type LiveWorksheet = { id?: string; name?: string };

export type PreparedDesktopDataApp = {
  packageId: string;
  sourceDir: string;
  worksheetFile: string;
  extensionsDatasourceId: string;
  worksheetId: string;
  worksheetName: string;
};

type BoundDatasource = {
  extensionsDatasourceId: string;
  caption: string;
};

type BoundWorksheet = {
  id: string;
  name: string;
};

function boundDatasource(
  datasourceId: string,
  datasources: LiveDatasource[],
): Result<BoundDatasource, McpToolError> {
  const matches = datasources.filter((datasource) => datasource.id === datasourceId);
  if (matches.length !== 1 || !matches[0].name || !matches[0].caption) {
    const available = datasources
      .filter((datasource) => datasource.id && datasource.name && datasource.caption)
      .map((datasource) => `${datasource.id} (${datasource.caption})`);
    return new McpToolError({
      type: 'datasource-not-selected',
      message:
        `Select one live datasource by its External API id. Requested "${datasourceId}". ` +
        `Available: ${available.length ? available.join(', ') : '(none)'}.`,
      statusCode: 400,
    }).toErr();
  }
  return new Ok({
    extensionsDatasourceId: matches[0].name,
    caption: matches[0].caption,
  });
}

function boundWorksheet(
  worksheetId: string,
  worksheets: LiveWorksheet[],
): Result<BoundWorksheet, McpToolError> {
  const matches = worksheets.filter((worksheet) => worksheet.id === worksheetId);
  if (matches.length !== 1 || !matches[0].name) {
    const available = worksheets
      .filter((worksheet) => worksheet.id && worksheet.name)
      .map((worksheet) => `${worksheet.id} (${worksheet.name})`);
    return new McpToolError({
      type: 'worksheet-not-selected',
      message:
        `Select one open worksheet by its External API id. Requested "${worksheetId}". ` +
        `Available: ${available.length ? available.join(', ') : '(none)'}.`,
      statusCode: 400,
    }).toErr();
  }
  return new Ok({ id: matches[0].id!, name: matches[0].name });
}

function worksheetXml(args: {
  worksheetName: string;
  worksheetId: string;
  packageId: string;
  version: string;
  sourceDir: string;
  extensionsDatasourceId: string;
  caption: string;
}): string {
  const name = escapeXml(args.worksheetName);
  const worksheetId = escapeXml(args.worksheetId);
  const datasource = escapeXml(args.extensionsDatasourceId);
  const caption = escapeXml(args.caption);
  const url = escapeXml(unzippedPackageSrcUrl(args.sourceDir));
  const instanceId = randomBytes(16).toString('hex').toUpperCase();
  return (
    `<worksheet name='${name}'>` +
    `<table><view><datasources><datasource caption='${caption}' name='${datasource}' /></datasources>` +
    "<aggregation value='true' /></view><style />" +
    "<panes><pane><view><breakdown value='auto' /></view>" +
    "<mark class='VizExtension' />" +
    `<add-in add-in-id='${escapeXml(args.packageId)}' extension-url='${url}' extension-version='${escapeXml(args.version)}' instance-id='${instanceId}'>` +
    '<instance-settings /><type-settings><worksheet /></type-settings></add-in>' +
    `</pane></panes><rows /><cols /></table><simple-id uuid='${worksheetId}' /></worksheet>`
  );
}

export async function prepareDesktopDataApp(args: {
  workspaceRoot: string;
  worksheetFile: string;
  templatePackageDir: string;
  datappName: string;
  worksheetId: string;
  datasourceId: string;
  datasources: LiveDatasource[];
  worksheets: LiveWorksheet[];
}): Promise<Result<PreparedDesktopDataApp, McpToolError>> {
  if (!isAbsolute(args.workspaceRoot)) {
    return new McpToolError({
      type: 'data-app-workspace-unconfigured',
      message:
        'Set TABLEAU_DATA_APP_WORKSPACE_DIR to an absolute directory before scaffolding a Desktop data app.',
      statusCode: 400,
    }).toErr();
  }

  const selectedWorksheet = boundWorksheet(args.worksheetId, args.worksheets);
  if (selectedWorksheet.isErr()) {
    return selectedWorksheet;
  }

  const selected = boundDatasource(args.datasourceId, args.datasources);
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
      `var BOUND_DATASOURCE_ID = ${JSON.stringify(selected.value.extensionsDatasourceId)};`,
    );
  });

  const xml = worksheetXml({
    worksheetName: selectedWorksheet.value.name,
    worksheetId: selectedWorksheet.value.id,
    packageId,
    version: identity.version,
    sourceDir,
    extensionsDatasourceId: selected.value.extensionsDatasourceId,
    caption: selected.value.caption,
  });
  await mkdir(resolve(args.worksheetFile, '..'), { recursive: true });
  await writeFile(args.worksheetFile, xml, 'utf8');

  return new Ok({
    packageId,
    sourceDir,
    worksheetFile: args.worksheetFile,
    extensionsDatasourceId: selected.value.extensionsDatasourceId,
    worksheetId: selectedWorksheet.value.id,
    worksheetName: selectedWorksheet.value.name,
  });
}
