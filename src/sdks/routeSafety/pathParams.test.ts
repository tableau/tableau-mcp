/**
 * Enforcement: every `:param` in every Zodios endpoint path under `src/sdks/tableau/apis/` must be
 * declared explicitly as a `Path` parameter whose schema comes from `pathParam(...)` / `idSchema`
 * (or is a closed `z.enum` of safe literals).
 * A bare `z.string()` (or an undeclared path param, which Zodios accepts unvalidated) fails here.
 *
 * The runtime guards in `./zodios.ts` still protect undeclared params; this test keeps the
 * declarative layer from regressing as endpoints are added.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

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
import { assertSafePathSegment } from './core.js';
import { isRouteSafeSchema } from './ids.js';

type Endpoint = {
  method: string;
  path: string;
  alias?: string;
  parameters?: Array<{ name: string; type: string; schema: unknown }>;
};

// Static imports (the project type-checks as CommonJS, so `import.meta.glob` is unavailable).
// The "covers every api module" test below fails if a new file is added without registering here.
const modules: Record<string, Record<string, unknown>> = {
  'authenticationApi.ts': authenticationApi,
  'contentExplorationApi.ts': contentExplorationApi,
  'datasourcesApi.ts': datasourcesApi,
  'flowDocumentApi.ts': flowDocumentApi,
  'flowsApi.ts': flowsApi,
  'jobsApi.ts': jobsApi,
  'knowledgeApi.ts': knowledgeApi,
  'mcpSettingsApi.ts': mcpSettingsApi,
  'metadataApi.ts': metadataApi,
  'packagesApi.ts': packagesApi,
  'paginationParameters.ts': paginationParameters,
  'personalSpaceApi.ts': personalSpaceApi,
  'projectsApi.ts': projectsApi,
  'pulseApi.ts': pulseApi,
  'serverApi.ts': serverApi,
  'tasksApi.ts': tasksApi,
  'usersApi.ts': usersApi,
  'viewsApi.ts': viewsApi,
  'vizqlDataServiceApi.ts': vizqlDataServiceApi,
  'workbooksApi.ts': workbooksApi,
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

const apisDir = join(__dirname, '..', 'tableau', 'apis');

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
  it('covers every api module', () => {
    const files = readdirSync(apisDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(Object.keys(modules).sort()).toEqual(files.sort());
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
