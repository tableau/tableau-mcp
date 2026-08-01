import { CeppSdkEventsModule, ICeppEvent } from './sdkTypes.js';

/**
 * `./events` subpath of the CEPP SDK — the generated event classes. Held in a `const`
 * (see the sibling note in `recorder.ts`) so the dynamic `import()` uses a non-literal
 * specifier and TypeScript/esbuild defer it to runtime instead of resolving this
 * internal, Nexus-only, non-dependency package at build time.
 */
const CEPP_SDK_EVENTS_MODULE = '@tableau/activitylog-logging-client-ts/events';

/**
 * Builds a POC ActivityLog event using the SDK's generated `ActivityLogSettingsChange`.
 *
 * This is the copyable pattern for wiring a real event: load the generated event class,
 * populate its fluent builder, and let `build()` validate + return an `ICeppEvent`. For
 * the POC every field is a fixed sample value — this event exists to prove the SDK's
 * builder path end to end, not to carry live signal. Required-field and format validation
 * happen inside the SDK's `build()` (it throws on missing/invalid), so we do none here.
 *
 * Returns `null` when the SDK isn't installed (external installs / public CI), matching
 * the recorder's absent-SDK behavior so the caller can no-op cleanly.
 */
export async function buildActivityLogSettingsChangeEvent(): Promise<ICeppEvent | null> {
  let events: CeppSdkEventsModule;
  try {
    events = (await import(CEPP_SDK_EVENTS_MODULE)) as CeppSdkEventsModule;
  } catch {
    return null;
  }

  return events.ActivityLogSettingsChange.builder()
    .setEventTime('2024-06-16T18:03:47.203309Z')
    .setServiceName('tableau-mcp')
    .setSiteLuid('12345678-1234-1234-1234-123456789abc')
    .setActorUserLuid('12345678-1234-1234-1234-123456789abc')
    .setInitiatingUserLuid('12345678-1234-1234-1234-123456789abc')
    .setPlatform('Tableau Cloud')
    .setPlatformVersion('POC')
    .setOperationType('create')
    .build();
}
