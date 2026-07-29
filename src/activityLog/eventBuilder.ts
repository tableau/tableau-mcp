import { ExampleToolInvokedEvent } from './sdk/events/exampleToolInvokedEvent.js';
import { ICeppEvent } from './sdk/index.js';

/** Request context an ActivityLog event is built from. Mirrors what tool callbacks expose. */
export type ActivityLogEventContext = {
  siteLuid: string;
  userLuid: string;
  toolName: string;
};

/**
 * Builds a representative "tool invoked" ActivityLog event from tool-call context.
 *
 * This is the copyable pattern for wiring a real event later: map request context onto
 * an SDK event builder and return the built `ICeppEvent`. When real TMCP schemas exist,
 * swap `ExampleToolInvokedEvent` for the generated event class and set its fields — the
 * shape (builder in, `ICeppEvent` out) stays the same.
 *
 * `eventTime` defaults to now (ISO-8601) but can be supplied for deterministic tests.
 */
export function buildExampleToolInvokedEvent(
  ctx: ActivityLogEventContext,
  eventTime: string = new Date().toISOString(),
): ICeppEvent {
  return ExampleToolInvokedEvent.builder()
    .setEventTime(eventTime)
    .setSiteLuid(ctx.siteLuid)
    .setActorUserLuid(ctx.userLuid || undefined)
    .setToolName(ctx.toolName)
    .build();
}
