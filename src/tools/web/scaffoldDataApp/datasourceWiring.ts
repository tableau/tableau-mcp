/**
 * Wires a published Tableau datasource into a scaffolded data-app `.twb` for the common
 * same-site/same-server case, so `scaffold-data-app` can return an already query-ready
 * workbook in a single call.
 *
 * This is a TypeScript port of the `author-data-app` skill's `wire-datasource.mjs` (now in the
 * tableau-plugin repo, kept for the out-of-scope migration case: re-wiring an already-wired
 * workbook onto a *different* datasource).
 * The wiring spans four coordinated locations (root datasource `name`, root `relation connection`,
 * view `datasource name`, `datasource-dependencies datasource`) that must agree exactly, and it's
 * easy to leave one empty `<datasources />` anchor behind. Get any of that wrong and the workbook
 * silently reaches no data.
 */

import { randomBytes } from 'node:crypto';

import { Ok, Result } from 'ts-results-es';

import { DatasourceNotAllowedError, McpToolError } from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { ProductVersion } from '../../../sdks/tableau/types/serverInfo.js';
import { RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES } from '../../../server/oauth/scopes.js';
import { fetchFieldsResult } from '../getDatasourceMetadata/fetchFieldsResult.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { TableauWebRequestHandlerExtra } from '../toolContext.js';

/** A field to be wired into the datasource, resolved from the datasource's metadata. */
export interface WiringField {
  name: string;
  datatype: string;
  role: 'measure' | 'dimension';
}

/** Everything needed to derive the wiring XML for a single published datasource. */
export interface DatasourceDescriptor {
  caption: string;
  repositoryId: string;
  site: string;
  server: string;
  channel: string;
  port: number;
  connectionName?: string;
  fields: WiringField[];
}

export interface DatasourceWiringEdits {
  connectionName: string;
  rootDatasourceXml: string;
  viewDatasourceXml: string;
}

const EMPTY_ANCHOR = '<datasources />';

/** datatype -> Tableau column `type`. */
export function typeOf(datatype: string): 'quantitative' | 'ordinal' | 'nominal' {
  switch (datatype.toLowerCase()) {
    case 'real':
    case 'integer':
      return 'quantitative';
    case 'date':
    case 'datetime':
      return 'ordinal';
    default:
      return 'nominal'; // string and anything unrecognized
  }
}

interface DerivedField extends WiringField {
  type: 'quantitative' | 'ordinal' | 'nominal';
  ordinal: number;
  aggregation: 'Sum' | 'Count';
  roleAttr: 0 | 1;
  localName: string;
  derivation: 'Sum' | 'None';
  instanceName: string;
}

/**
 * A field's derived attributes, computed once and reused across all blocks so the root
 * metadata-record, the view column, and the column-instance agree.
 */
export function deriveField(field: WiringField, ordinal: number): DerivedField {
  const isMeasure = field.role === 'measure';
  const type = typeOf(field.datatype);
  return {
    ...field,
    type,
    ordinal,
    aggregation: isMeasure ? 'Sum' : 'Count',
    // role attribute: 0 = dimension, 1 = measure
    roleAttr: isMeasure ? 1 : 0,
    localName: `[${field.name}]`,
    // column-instance derivation + name token: [sum:Profit:qk] / [none:Region:nk]
    derivation: isMeasure ? 'Sum' : 'None',
    instanceName: isMeasure ? `[sum:${field.name}:qk]` : `[none:${field.name}:nk]`,
  };
}

/** Escapes a value for XML attribute/text safety (single-quoted attrs + element text). */
export function esc(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;')
    .replace(/"/g, '&quot;');
}

/** Generates a `sqlproxy.<hex>` connection name, truncated to 37 characters total. */
export function generateConnectionName(): string {
  return `sqlproxy.${randomBytes(24).toString('hex')}`.slice(0, 37);
}

/**
 * Given a resolved datasource descriptor, builds the root datasource XML block and the view
 * datasource XML block that fill the scaffolded `.twb`'s two empty `<datasources />` anchors, and
 * returns the connection name that joins them. Mirrors `wire-datasource.mjs`'s XML shape exactly.
 */
export function buildDatasourceWiringEdits(
  descriptor: DatasourceDescriptor,
): DatasourceWiringEdits {
  const { caption, repositoryId, site, server, channel, port, fields: fieldsIn } = descriptor;

  if (fieldsIn.length === 0) {
    throw new Error('Descriptor "fields" must list at least one field the app will query.');
  }

  const connectionName = descriptor.connectionName || generateConnectionName();
  if (!connectionName.startsWith('sqlproxy.')) {
    throw new Error(`connectionName must start with "sqlproxy." (got "${connectionName}").`);
  }

  const fields = fieldsIn.map((f, i) => deriveField(f, i));

  const metadataRecords = fields
    .map(
      (f) => `          <metadata-record class='column'>
            <remote-name>${esc(f.name)}</remote-name>
            <remote-type>${f.type === 'quantitative' ? 5 : 129}</remote-type>
            <local-name>${esc(f.localName)}</local-name>
            <parent-name>[sqlproxy]</parent-name>
            <remote-alias>${esc(f.name)}</remote-alias>
            <ordinal>${f.ordinal}</ordinal>
            <layered>true</layered>
            <local-type>${esc(f.datatype)}</local-type>
            <aggregation>${f.aggregation}</aggregation>
            <contains-null>true</contains-null>
            <attributes>
              <attribute datatype='integer' name='field-type'>1</attribute>
              <attribute datatype='integer' name='role'>${f.roleAttr}</attribute>
            </attributes>
          </metadata-record>`,
    )
    .join('\n');

  const rootDatasourceXml = `<datasources>
    <datasource caption='${esc(caption)}' inline='true' name='${esc(connectionName)}' version='18.1'>
      <repository-location id='${esc(repositoryId)}' path='/t/${esc(site)}/datasources' revision='1.0' site='${esc(site)}' />
      <connection channel='${esc(channel)}' class='sqlproxy' dbname='${esc(repositoryId)}' directory='dataserver' port='${esc(port)}' server='${esc(server)}' server-ds-friendly-name='${esc(caption)}' username=''>
        <relation type='collection'>
          <relation connection='${esc(connectionName)}' name='sqlproxy' table='[sqlproxy]' type='table' />
        </relation>
        <metadata-records>
${metadataRecords}
        </metadata-records>
      </connection>
    </datasource>
  </datasources>`;

  const viewColumns = fields
    .map(
      (f) =>
        `            <column aggregation='${f.aggregation}' datatype='${esc(f.datatype)}' name='${esc(f.localName)}' role='${f.role}' type='${f.type}' />`,
    )
    .join('\n');

  const viewColumnInstances = fields
    .map(
      (f) =>
        `            <column-instance column='${esc(f.localName)}' derivation='${f.derivation}' name='${esc(f.instanceName)}' pivot='key' type='${f.type}' />`,
    )
    .join('\n');

  const viewDatasourceXml = `<datasources>
            <datasource caption='${esc(caption)}' name='${esc(connectionName)}' />
          </datasources>
          <datasource-dependencies datasource='${esc(connectionName)}'>
${viewColumns}
${viewColumnInstances}
          </datasource-dependencies>`;

  return { connectionName, rootDatasourceXml, viewDatasourceXml };
}

/**
 * Applies the two wiring blocks to a `.twb`'s in-memory content via two sequential
 * first-occurrence replacements of the literal `<datasources />` anchor (root, then view), then
 * verifies the connection name appears at least 4 times (root datasource name, root relation
 * connection, view datasource name, datasource-dependencies datasource). Used by
 * `buildFinalizedEntries` for both output modes (disk and S3), since both finalize the workspace
 * server-side.
 */
export function applyDatasourceWiring(twbContent: string, edits: DatasourceWiringEdits): string {
  const { connectionName, rootDatasourceXml, viewDatasourceXml } = edits;

  const rootIdx = twbContent.indexOf(EMPTY_ANCHOR);
  if (rootIdx === -1) {
    throw new Error(`Root "${EMPTY_ANCHOR}" anchor not found — already wired or template drifted.`);
  }
  let wired =
    twbContent.slice(0, rootIdx) +
    rootDatasourceXml +
    twbContent.slice(rootIdx + EMPTY_ANCHOR.length);

  const viewIdx = wired.indexOf(EMPTY_ANCHOR);
  if (viewIdx === -1) {
    throw new Error(`View "${EMPTY_ANCHOR}" anchor not found — already wired or template drifted.`);
  }
  wired = wired.slice(0, viewIdx) + viewDatasourceXml + wired.slice(viewIdx + EMPTY_ANCHOR.length);

  if (wired.includes(EMPTY_ANCHOR)) {
    throw new Error(
      'An empty <datasources /> anchor survived wiring — refusing to write a half-wired workbook.',
    );
  }
  const refCount = wired.split(`'${connectionName}'`).length - 1;
  if (refCount < 4) {
    throw new Error(
      `Expected the connection name to appear >=4 times, saw ${refCount} — wiring incomplete.`,
    );
  }

  return wired;
}

/**
 * Resolves everything `buildDatasourceWiringEdits` needs from a datasource LUID: access check,
 * published-datasource lookup, effective server/site, and field metadata for every field on the
 * datasource. Cross-site/cross-server wiring is out of scope — the descriptor's `server`/`site`
 * always reflect the caller's current site/server.
 */
export async function resolveDatasourceDescriptor({
  datasourceLuid,
  extra,
  productVersion,
}: {
  datasourceLuid: string;
  extra: TableauWebRequestHandlerExtra;
  productVersion: ProductVersion;
}): Promise<Result<DatasourceDescriptor, McpToolError>> {
  const isDatasourceAllowedResult = await resourceAccessChecker.isDatasourceAllowed({
    datasourceLuid,
    extra,
  });
  if (!isDatasourceAllowedResult.allowed) {
    return new DatasourceNotAllowedError(isDatasourceAllowedResult.message).toErr();
  }

  const datasource = await useRestApi({
    ...extra,
    jwtScopes: RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES,
    callback: async (restApi) =>
      await restApi.datasourcesMethods.queryDatasource({
        siteId: restApi.siteId,
        datasourceId: datasourceLuid,
      }),
  });

  const caption = datasource.name;
  const repositoryId = datasource.contentUrl ?? datasource.name;

  const site = extra.getSiteName();
  const serverUrlString = extra.tableauAuthInfo?.server ?? extra.config.server;
  const serverUrl = new URL(serverUrlString);
  const channel = serverUrl.protocol.replace(/:$/, '');
  const port = serverUrl.port ? Number(serverUrl.port) : channel === 'https' ? 443 : 80;
  const server = serverUrl.hostname;

  const fieldsResultResult = await fetchFieldsResult({
    datasourceLuid,
    extra,
    productVersion,
    jwtScopes: ['tableau:viz_data_service:read', ...RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES],
  });

  if (fieldsResultResult.isErr()) {
    return fieldsResultResult;
  }

  const fields: WiringField[] = fieldsResultResult.value.fieldGroups.flatMap((group) =>
    group.fields.map((field) => ({
      name: field.name ?? '',
      datatype: (field.dataType ?? 'string').toLowerCase(),
      role: field.role?.toUpperCase() === 'MEASURE' ? 'measure' : 'dimension',
    })),
  );

  return new Ok({ caption, repositoryId, site, server, channel, port, fields });
}
