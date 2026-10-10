/**
 * Enforcement: every `:param` in every Zodios endpoint path under `src/sdks/` must be declared
 * explicitly as a `Path` parameter whose schema behaves like `pathParam(...)` (throws
 * `RouteSafetyError` on a traversal payload) or is a closed `z.enum` of safe literals.
 * A bare `z.string()` (or an undeclared path param, which Zodios accepts unvalidated) fails here.
 *
 * The runtime guards in `./zodios.ts` still protect undeclared params; this test keeps the
 * declarative layer from regressing as endpoints are added.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { z } from 'zod';

import * as agentApi from '../desktop/agentApi/apis.js';
import * as authenticationApi from '../tableau/apis/authenticationApi.js';
import * as contentExplorationApi from '../tableau/apis/contentExplorationApi.js';
import * as datasourcesApi from '../tableau/apis/datasourcesApi.js';
import * as flowDocumentApi from '../tableau/apis/flowDocumentApi.js';
import * as flowsApi from '../tableau/apis/flowsApi.js';
import * as jobsApi from '../tableau/apis/jobsApi.js';
import * as knowledgeApi from '../tableau/apis/knowledgeApi.js';
import * as mcpSettingsApi from '../tableau/apis/mcpSettingsApi.js';
import * as metadataApi from '../tableau/apis/metadataApi.js';
import * as packagesApi from '../tableau/apis/packagesApi.js';
import * as paginationParameters from '../tableau/apis/paginationParameters.js';
import * as personalSpaceApi from '../tableau/apis/personalSpaceApi.js';
import * as projectsApi from '../tableau/apis/projectsApi.js';
import * as pulseApi from '../tableau/apis/pulseApi.js';
import * as serverApi from '../tableau/apis/serverApi.js';
import * as tasksApi from '../tableau/apis/tasksApi.js';
import * as usersApi from '../tableau/apis/usersApi.js';
import * as viewsApi from '../tableau/apis/viewsApi.js';
import * as vizqlDataServiceApi from '../tableau/apis/vizqlDataServiceApi.js';
import * as workbooksApi from '../tableau/apis/workbooksApi.js';
import * as tableauOAuthApi from '../tableau-oauth/apis.js';
import { assertSafePathSegment, RouteSafetyError } from './core.js';

type Endpoint = {
  method: string;
  path: string;
  alias?: string;
  parameters?: Array<{ name: string; type: string; schema: unknown }>;
};

// Static imports (the project type-checks as CommonJS, so `import.meta.glob` is unavailable).
// The "covers every api module" test below fails if a new file is added without registering here.
const modules: Record<string, Record<string, unknown>> = {
  'desktop/agentApi/apis.ts': agentApi,
  'tableau-oauth/apis.ts': tableauOAuthApi,
  'tableau/apis/authenticationApi.ts': authenticationApi,
  'tableau/apis/contentExplorationApi.ts': contentExplorationApi,
  'tableau/apis/datasourcesApi.ts': datasourcesApi,
  'tableau/apis/flowDocumentApi.ts': flowDocumentApi,
  'tableau/apis/flowsApi.ts': flowsApi,
  'tableau/apis/jobsApi.ts': jobsApi,
  'tableau/apis/knowledgeApi.ts': knowledgeApi,
  'tableau/apis/mcpSettingsApi.ts': mcpSettingsApi,
  'tableau/apis/metadataApi.ts': metadataApi,
  'tableau/apis/packagesApi.ts': packagesApi,
  'tableau/apis/paginationParameters.ts': paginationParameters,
  'tableau/apis/personalSpaceApi.ts': personalSpaceApi,
  'tableau/apis/projectsApi.ts': projectsApi,
  'tableau/apis/pulseApi.ts': pulseApi,
  'tableau/apis/serverApi.ts': serverApi,
  'tableau/apis/tasksApi.ts': tasksApi,
  'tableau/apis/usersApi.ts': usersApi,
  'tableau/apis/viewsApi.ts': viewsApi,
  'tableau/apis/vizqlDataServiceApi.ts': vizqlDataServiceApi,
  'tableau/apis/workbooksApi.ts': workbooksApi,
};

// A closed z.enum is stricter than a free-form segment, so it is accepted as long as every literal
// value is itself a safe path segment (e.g. Pulse `:bundle_type`).
const isSafeEnum = (schema: unknown): boolean =>
  schema instanceof z.ZodEnum &&
  (schema.options as string[]).every((v) => {
    try {
      assertSafePathSegment('enum', v);
      return true;
    } catch {
      return false;
    }
  });

const sdksDir = join(__dirname, '..');

// Every non-test source file under src/sdks that defines Zodios endpoints.
const endpointModuleFiles = (readdirSync(sdksDir, { recursive: true }) as string[])
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .filter((f) => /\b(makeApi|makeEndpoint)\(/.test(readFileSync(join(sdksDir, f), 'utf8')))
  .map((f) => relative(sdksDir, join(sdksDir, f)).split('\\').join('/'));

// A `pathParam(...)` schema throws RouteSafetyError on a traversal payload (it never returns a
// Zod issue, see ./ids.ts). A bare `z.string()` would accept it.
const isRouteSafeSchema = (schema: unknown): boolean => {
  if (!(schema instanceof z.ZodType)) return false;
  try {
    schema.safeParse('../workbooks/x');
    return false;
  } catch (e) {
    return e instanceof RouteSafetyError;
  }
};

const isEndpoint = (e: unknown): e is Endpoint =>
  typeof e === 'object' &&
  e !== null &&
  typeof (e as Endpoint).path === 'string' &&
  typeof (e as Endpoint).method === 'string';

const endpoints: Array<[string, Endpoint]> = [];
for (const [file, mod] of Object.entries(modules)) {
  const seen = new Set<Endpoint>();
  for (const value of Object.values(mod)) {
    if (!Array.isArray(value)) continue;
    for (const e of value) {
      if (isEndpoint(e) && !seen.has(e)) {
        seen.add(e);
        endpoints.push([file, e]);
      }
    }
  }
}

const cases = endpoints.flatMap(([file, e]) =>
  [...e.path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map(
    ([, name]) => [`${file} ${e.alias ?? `${e.method} ${e.path}`} :${name}`, e, name] as const,
  ),
);

describe('REST path-param enforcement', () => {
  it('covers every module that defines Zodios endpoints', () => {
    const registered = Object.keys(modules);
    expect(endpointModuleFiles.filter((f) => !registered.includes(f))).toEqual([]);
  });

  it('discovers endpoints with path params', () => {
    expect(endpoints.length).toBeGreaterThan(20);
    expect(cases.length).toBeGreaterThan(20);
  });

  it.each(cases)('%s is declared with pathParam()', (_label, endpoint, name) => {
    const param = endpoint.parameters?.find((p) => p.type === 'Path' && p.name === name);
    expect(param, `missing explicit Path parameter '${name}'`).toBeDefined();
    expect(
      isRouteSafeSchema(param!.schema) || isSafeEnum(param!.schema),
      `Path parameter '${name}' must use pathParam() / idSchema() (or a closed z.enum), not a bare z.string()`,
    ).toBe(true);
  });
});
