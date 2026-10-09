/**
 * Activity Log initialization and provider factory
 */

import { resolve } from 'path';

import { getConfig } from '../config.js';
import { getFeatureGate } from '../features/init.js';
import { log } from '../logging/logger.js';
import { getExceptionMessage } from '../utils/getExceptionMessage.js';
import { NoOpActivityLogProvider } from './noop.js';
import type { ActivityLogProvider, ToolCallDetails } from './provider.js';
import { isActivityLogProvider } from './types.js';

const ACTIVITY_LOG_LOGGER = 'activityLog';
const ACTIVITY_LOG_FEATURE = 'activity-log';

function isRecord(obj: unknown): obj is Record<string, unknown> {
  return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
}

/**
 * Validate that a provider implements the ActivityLogProvider interface.
 */
function validateActivityLogProvider(provider: unknown): asserts provider is ActivityLogProvider {
  if (!isRecord(provider)) {
    throw new Error('Provider must be an object');
  }

  if (typeof provider.recordToolCall !== 'function') {
    throw new Error('Custom provider missing required method: recordToolCall');
  }
}

const noop = new NoOpActivityLogProvider();

// Module singleton
let provider: ActivityLogProvider | null = null;

/**
 * Initialize the Activity Log provider based on configuration.
 *
 * Call early in application startup, after the feature gate. Nothing is recorded, and no provider
 * is loaded, unless the `activity-log` feature flag is enabled. A provider that can't be loaded is
 * logged and replaced by the no-op, because recording is never worth failing to serve tool calls.
 */
export async function initializeActivityLog(): Promise<void> {
  try {
    if (!(await getFeatureGate().isFeatureEnabled(ACTIVITY_LOG_FEATURE))) {
      provider = new NoOpActivityLogProvider();
      return;
    }

    const requested = process.env.ACTIVITY_LOG_PROVIDER?.trim();
    if (requested && !isActivityLogProvider(requested)) {
      // Silently recording nothing is the worst failure for an audit log.
      log({
        message: `Unrecognized ACTIVITY_LOG_PROVIDER "${requested}", so events are not recorded`,
        level: 'warning',
        logger: ACTIVITY_LOG_LOGGER,
      });
    }

    const config = getConfig();
    provider =
      config.activityLog.provider === 'custom'
        ? loadCustomProvider(config.activityLog.providerConfig)
        : new NoOpActivityLogProvider();
  } catch (error) {
    log({
      message: 'Failed to initialize the Activity Log provider, so events are not recorded',
      level: 'error',
      logger: ACTIVITY_LOG_LOGGER,
      data: error,
    });
    provider = new NoOpActivityLogProvider();
  }
}

/**
 * Records a finished tool call. Never throws or rejects, so callers can ignore the result:
 * recording must not change a tool call's result.
 */
export function recordToolCall(details: ToolCallDetails): void {
  try {
    const result = (provider ?? noop).recordToolCall(details);
    // Only a promise needs a handler; the no-op and synchronous providers allocate nothing.
    if (typeof (result as PromiseLike<void> | undefined)?.then === 'function') {
      Promise.resolve(result).catch((error) => logRecordingFailure(details, error));
    }
  } catch (error) {
    logRecordingFailure(details, error);
  }
}

function logRecordingFailure(details: ToolCallDetails, error: unknown): void {
  log({
    message: `Activity Log recording failed for ${details.toolName}: ${getExceptionMessage(error)}`,
    level: 'warning',
    logger: ACTIVITY_LOG_LOGGER,
  });
}

/**
 * Load a custom Activity Log provider from the user's filesystem or npm package.
 *
 * The custom provider module should export a default class (or named export "ActivityLogProvider")
 * that implements ActivityLogProvider.
 *
 * @example Custom provider from file
 * ACTIVITY_LOG_PROVIDER=custom
 * ACTIVITY_LOG_PROVIDER_CONFIG='{"module":"./my-activity-log-provider.js"}'
 */
function loadCustomProvider(config?: Record<string, unknown>): ActivityLogProvider {
  if (!config?.module) {
    throw new Error(
      'Custom Activity Log provider requires "module" in providerConfig. ' +
        'Example: ACTIVITY_LOG_PROVIDER_CONFIG=\'{"module":"./my-activity-log-provider.js"}\'',
    );
  }

  const modulePath = config.module;

  if (typeof modulePath !== 'string') {
    throw new Error('Custom Activity Log provider requires "module" to be a string');
  }

  // Determine if it's a file path or npm package name
  let resolvedPath: string;

  if (modulePath.startsWith('.') || modulePath.startsWith('/')) {
    // File path - resolve relative to process working directory (user's project root)
    resolvedPath = resolve(process.cwd(), modulePath);
  } else {
    // npm package name - require as-is
    resolvedPath = modulePath;
  }

  try {
    // `module` is trusted operator-controlled config, same trust model as
    // FEATURE_GATE_PROVIDER/TELEMETRY_PROVIDER's custom loaders.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Sync load for preload script
    const module = require(resolvedPath);

    // Look for default export or named export "ActivityLogProvider"
    const ProviderClass = module.default || module.ActivityLogProvider;

    if (!ProviderClass) {
      throw new Error(
        `Module ${modulePath} must export a default class or named export "ActivityLogProvider" ` +
          'that implements the ActivityLogProvider interface',
      );
    }

    // Instantiate the provider with the full config
    const provider = new ProviderClass(config);

    // Validate the provider implements ActivityLogProvider interface
    validateActivityLogProvider(provider);
    return provider;
  } catch (error) {
    // Provide helpful error message with common issues
    let errorMessage = `Failed to load custom Activity Log provider from "${modulePath}". `;

    if (error instanceof Error && 'code' in error && error.code === 'MODULE_NOT_FOUND') {
      errorMessage +=
        'Module not found. ' +
        'If using a file path, ensure the file exists and the path is correct. ' +
        'If using an npm package, ensure it is installed.';
    } else {
      errorMessage += `Error: ${error}`;
    }

    throw new Error(errorMessage);
  }
}

/**
 * Flush and release the configured provider's resources on shutdown. Awaited from the SIGTERM/SIGINT
 * handler in `index.ts`. A provider without `close()` needs nothing.
 */
export async function closeActivityLog(): Promise<void> {
  await provider?.close?.();
}

/**
 * Reset the Activity Log provider (for testing purposes only)
 */
export function resetActivityLog(): void {
  provider = null;
}
