#!/usr/bin/env node
/**
 * Deterministically wire a published datasource into a scaffolded data-app `.twb`.
 *
 * The `scaffold-data-app` MCP tool emits a workbook with TWO empty
 * `<datasources />` anchors — one at the workbook root and one inside the
 * worksheet `<view>`. Until they are filled, the running extension calls
 * `getAllDataSourcesAsync()`, finds nothing, and renders "no data source found
 * in the workbook." This script fills both anchors with a single published
 * `sqlproxy` (Data Server) datasource, keeping the `sqlproxy.<hash>` join key
 * byte-identical everywhere it must appear.
 *
 * It is a script rather than freehand XML for the same reason as apply-plan.mjs:
 * the wiring spans four coordinated locations (root datasource `name`, root
 * `relation connection`, view `datasource name`, `datasource-dependencies
 * datasource`) that must agree exactly, and it's easy to leave one empty anchor
 * behind. Get any of that wrong and the workbook silently reaches no data.
 *
 * Usage:
 *   node wire-datasource.mjs <path-to.twb> <descriptor.json>
 *
 * descriptor.json (Claude assembles from list-datasources + get-datasource-metadata;
 * list ONLY the fields the app will query):
 *   {
 *     "caption":      "Superstore Datasource",
 *     "repositoryId": "SuperstoreDatasource",   // published DS contentUrl (== repo-location id / dbname)
 *     "site":         "mcp-test",
 *     "server":       "10ax.online.tableau.com",
 *     "channel":      "https",   // optional, default https
 *     "port":         443,       // optional, default 443 (use http/80 for on-prem)
 *     "connectionName": "sqlproxy.<hash>",  // optional, generated if omitted
 *     "fields": [
 *       { "name": "Profit", "datatype": "real",   "role": "measure"   },
 *       { "name": "Region", "datatype": "string", "role": "dimension" }
 *     ]
 *   }
 *
 * Exits non-zero with a diagnostic on any failure (missing/already-filled
 * anchor, empty fields, drifted template) rather than emitting a broken workbook.
 * Prints the wired `.twb` path on stdout.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The exact empty anchors emitted by the scaffold template. Matched literally.
const EMPTY_ANCHOR = '<datasources />';

function die(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

// XML attribute-value escaping (single-quoted attrs + element text).
function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;')
    .replace(/"/g, '&quot;');
}

// datatype -> Tableau column `type`.
function typeOf(datatype) {
  switch (String(datatype).toLowerCase()) {
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

// A field's derived attributes, computed once and reused across all blocks so
// the root metadata-record, the view column, and the column-instance agree.
function deriveField(field, ordinal) {
  const name = field?.name;
  if (!name || typeof name !== 'string') {
    die(`Every field needs a string "name" (field #${ordinal} was ${JSON.stringify(field)}).`);
  }
  const datatype = String(field.datatype || 'string').toLowerCase();
  const role = field.role === 'measure' ? 'measure' : 'dimension';
  const isMeasure = role === 'measure';
  const type = typeOf(datatype);
  return {
    name,
    datatype,
    role,
    type,
    ordinal,
    aggregation: isMeasure ? 'Sum' : 'Count',
    // role attribute: 0 = dimension, 1 = measure
    roleAttr: isMeasure ? 1 : 0,
    localName: `[${name}]`,
    // column-instance derivation + name token: [sum:Profit:qk] / [none:Region:nk]
    derivation: isMeasure ? 'Sum' : 'None',
    instanceName: isMeasure ? `[sum:${name}:qk]` : `[none:${name}:nk]`,
  };
}

// --- args ---------------------------------------------------------------

const [, , twbPathArg, descriptorPathArg] = process.argv;
if (!twbPathArg || !descriptorPathArg) {
  die('Usage: node wire-datasource.mjs <path-to.twb> <descriptor.json>');
}
const twbPath = resolve(twbPathArg);

let descriptor;
try {
  descriptor = JSON.parse(readFileSync(descriptorPathArg, 'utf8'));
} catch (error) {
  die(`Could not read/parse descriptor JSON at ${descriptorPathArg}: ${error.message}`);
}

const { caption, repositoryId, site, server } = descriptor;
for (const [key, value] of Object.entries({ caption, repositoryId, site, server })) {
  if (!value || typeof value !== 'string') {
    die(`Descriptor is missing required string "${key}".`);
  }
}
const channel = descriptor.channel || 'https';
const port = descriptor.port ?? (channel === 'https' ? 443 : 80);

const fieldsIn = Array.isArray(descriptor.fields) ? descriptor.fields : [];
if (fieldsIn.length === 0) {
  die('Descriptor "fields" must list at least one field the app will query.');
}
const fields = fieldsIn.map(deriveField);

// Single source of truth for the join key.
const connectionName =
  descriptor.connectionName ||
  `sqlproxy.${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`.slice(0, 37);
if (!connectionName.startsWith('sqlproxy.')) {
  die(`connectionName must start with "sqlproxy." (got "${connectionName}").`);
}

// --- build the XML blocks ----------------------------------------------

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

const rootDatasource = `<datasources>
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

const viewDatasources = `<datasources>
            <datasource caption='${esc(caption)}' name='${esc(connectionName)}' />
          </datasources>
          <datasource-dependencies datasource='${esc(connectionName)}'>
${viewColumns}
${viewColumnInstances}
          </datasource-dependencies>`;

// --- apply, splitting on <worksheets> so each anchor is unambiguous ------

let content;
try {
  content = readFileSync(twbPath, 'utf8');
} catch (error) {
  die(`Could not read .twb at ${twbPath}: ${error.message}`);
}

const splitIdx = content.indexOf('<worksheets>');
if (splitIdx === -1) {
  die('No <worksheets> element found — is this a scaffolded data-app .twb?');
}
let head = content.slice(0, splitIdx);
let tail = content.slice(splitIdx);

// Root anchor lives in the head (before <worksheets>).
if (!head.includes(EMPTY_ANCHOR)) {
  die(`Root "${EMPTY_ANCHOR}" anchor not found before <worksheets> — already wired or template drifted.`);
}
head = head.replace(EMPTY_ANCHOR, rootDatasource);

// View anchor is the first empty <datasources /> inside the worksheets section.
if (!tail.includes(EMPTY_ANCHOR)) {
  die(`View "${EMPTY_ANCHOR}" anchor not found inside <worksheets> — already wired or template drifted.`);
}
tail = tail.replace(EMPTY_ANCHOR, viewDatasources);

const wired = head + tail;

// --- verify before writing ----------------------------------------------

if (wired.includes(EMPTY_ANCHOR)) {
  die('An empty <datasources /> anchor survived wiring — refusing to write a half-wired workbook.');
}
// name appears: root datasource name, root relation connection, view datasource
// name, datasource-dependencies datasource = at least 4 references.
const refCount = wired.split(`'${connectionName}'`).length - 1;
if (refCount < 4) {
  die(`Expected the connection name to appear >=4 times, saw ${refCount} — wiring incomplete.`);
}

writeFileSync(twbPath, wired, 'utf8');
console.error(`✓ Wired datasource '${caption}' (${connectionName}) with ${fields.length} field(s) into ${twbPath}`);
console.log(twbPath);
