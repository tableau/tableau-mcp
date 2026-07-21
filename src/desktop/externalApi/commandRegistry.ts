import { readFileSync } from 'fs';
import { join } from 'path';

import { log } from '../../logging/logger.js';

const REGISTRY_DIR_ENV = 'EXTERNAL_API_REGISTRY_DIR';
const COMMAND_PARAM_REGISTRY_FILE = 'command_param_registry.json';
const CODEGEN_REGISTRY_FILE = 'codegen_registry.json';

export type ExternalApiRegistryParam = {
  local: string;
  type: string;
  required: boolean;
  wire: string;
  camelToDashed: string;
};

export type ExternalApiCommandRegistryEntry = {
  invocable: boolean;
  blockingDialog: boolean;
  requiredParams: ExternalApiRegistryParam[];
  params: ExternalApiRegistryParam[];
  paramWireByLocal: ReadonlyMap<string, string>;
  paramWireByCamelToDashed: ReadonlyMap<string, string>;
  enumValuesForParamType: ReadonlyMap<string, string[]>;
};

type ParsedRegistry = {
  commands: Map<string, ExternalApiCommandRegistryEntry>;
};

type RegistryCache = {
  dir: string | null;
  registry: ParsedRegistry | null;
};

type RawCommandEntry = {
  agent_can_invoke?: unknown;
  opens_blocking_dialog?: unknown;
  in_params?: unknown;
};

type RawCommandParam = {
  local?: unknown;
  type?: unknown;
  required?: unknown;
  wire?: unknown;
};

type RawCodegenRegistry = {
  type_of_param?: unknown;
  enum_vals?: unknown;
};

let cache: RegistryCache | undefined;

export function lookupExternalApiCommandRegistry(
  namespace: string,
  command: string,
): ExternalApiCommandRegistryEntry | null {
  const registry = loadRegistry();
  return registry?.commands.get(`${namespace}:${command}`) ?? null;
}

export function isExternalApiCommandRegistryEnabled(): boolean {
  return loadRegistry() !== null;
}

export function _resetExternalApiCommandRegistryForTest(): void {
  cache = undefined;
}

function loadRegistry(): ParsedRegistry | null {
  const dir = normalizedRegistryDir();
  if (cache?.dir === dir) {
    return cache.registry;
  }

  if (dir === null) {
    debugFailOpen('env-unset');
    cache = { dir, registry: null };
    return null;
  }

  try {
    const commandParamRegistry = parseJsonObject(
      readFileSync(join(dir, COMMAND_PARAM_REGISTRY_FILE), 'utf-8'),
    );
    const codegenRegistry = parseJsonObject(
      readFileSync(join(dir, CODEGEN_REGISTRY_FILE), 'utf-8'),
    ) as RawCodegenRegistry;
    const registry = parseRegistry(commandParamRegistry, codegenRegistry);
    cache = { dir, registry };
    return registry;
  } catch (error) {
    debugFailOpen('unreadable-or-invalid', dir, error);
    cache = { dir, registry: null };
    return null;
  }
}

function normalizedRegistryDir(): string | null {
  const value = process.env[REGISTRY_DIR_ENV]?.trim();
  return value ? value : null;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw);
  if (!isRecord(parsed) || Array.isArray(parsed)) {
    throw new Error('registry root must be an object');
  }
  return parsed;
}

function parseRegistry(
  commandParamRegistry: Record<string, unknown>,
  codegenRegistry: RawCodegenRegistry,
): ParsedRegistry {
  const enumVals = isRecord(codegenRegistry.enum_vals) ? codegenRegistry.enum_vals : {};
  const typeOfParam = isRecord(codegenRegistry.type_of_param) ? codegenRegistry.type_of_param : {};
  const commands = new Map<string, ExternalApiCommandRegistryEntry>();

  for (const [fullyQualifiedCommand, rawEntry] of Object.entries(commandParamRegistry)) {
    if (!isRecord(rawEntry)) {
      continue;
    }
    const entry = rawEntry as RawCommandEntry;
    const params = parseParams(entry.in_params);
    const enumValuesForParamType = new Map<string, string[]>();
    for (const param of params) {
      const values = enumValuesForType(param.type, enumVals, typeOfParam);
      if (values.length > 0) {
        enumValuesForParamType.set(param.type, values);
      }
    }

    commands.set(fullyQualifiedCommand, {
      invocable: entry.agent_can_invoke === true,
      blockingDialog: entry.opens_blocking_dialog === true,
      requiredParams: params.filter((param) => param.required),
      params,
      paramWireByLocal: new Map(params.map((param) => [param.local, param.wire])),
      paramWireByCamelToDashed: new Map(params.map((param) => [param.camelToDashed, param.wire])),
      enumValuesForParamType,
    });
  }

  return { commands };
}

function parseParams(rawParams: unknown): ExternalApiRegistryParam[] {
  if (!Array.isArray(rawParams)) {
    return [];
  }

  return rawParams.flatMap((rawParam): ExternalApiRegistryParam[] => {
    if (!isRecord(rawParam)) {
      return [];
    }
    const param = rawParam as RawCommandParam;
    if (
      typeof param.local !== 'string' ||
      typeof param.type !== 'string' ||
      typeof param.wire !== 'string' ||
      param.local.length === 0 ||
      param.type.length === 0 ||
      param.wire.length === 0
    ) {
      return [];
    }

    return [
      {
        local: param.local,
        type: param.type,
        required: param.required === true,
        wire: param.wire,
        camelToDashed: camelToDashed(param.local),
      },
    ];
  });
}

function enumValuesForType(
  paramType: string,
  enumVals: Record<string, unknown>,
  typeOfParam: Record<string, unknown>,
): string[] {
  const direct = stringArray(enumVals[paramType]);
  if (direct.length > 0) {
    return direct;
  }

  if (paramType.startsWith('DPI_')) {
    const withoutPrefix = stringArray(enumVals[paramType.slice(4)]);
    if (withoutPrefix.length > 0) {
      return withoutPrefix;
    }
  }

  const enumName = enumNameFrom(typeOfParam[paramType]);
  return enumName ? stringArray(enumVals[enumName]) : [];
}

function enumNameFrom(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (!isRecord(value)) {
    return null;
  }
  for (const key of ['enum_name', 'enumName', 'enum', 'name', 'type_name', 'typeName']) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }
  return null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function camelToDashed(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function debugFailOpen(reason: string, dir?: string, error?: unknown): void {
  log({
    message: 'External API command registry disabled; fail-open to current command guards',
    level: 'debug',
    logger: 'desktop',
    data: {
      reason,
      ...(dir ? { dir } : {}),
      ...(error instanceof Error ? { error: error.message } : {}),
    },
  });
}
