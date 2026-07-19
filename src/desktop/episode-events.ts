import { randomUUID } from 'crypto';

import pkg from '../../package.json';
import { BaseConfig } from '../config.shared.js';
import { FileLogger } from '../logging/fileLogger.js';
import { getExceptionMessage } from '../utils/getExceptionMessage.js';
import {
  type RouteReceipt,
  serializeRouteReceipt,
  sessionRouteState,
} from './route/route-state.js';
import type { PromiseOutcome } from './validation/promise-check.js';
import type {
  ReadbackFinding,
  ReadbackVerificationResult,
  ReadbackVerificationStatus,
} from './validation/readback-verify.js';

type EpisodeConfig = BaseConfig & {
  desktopSessionId?: string;
};

export type EpisodeStatus = 'succeeded' | 'failed' | 'abandoned';

type EventBase = {
  session_id: string;
  episode_id?: string;
};

export type EpisodeEventInput =
  | (EventBase & {
      type: 'episode_begin';
      intent?: string;
      source: 'agent' | 'client' | 'auto';
      tags?: string[];
      system_prompt_version?: string;
      tool_profile?: string;
      agent_types?: string[];
      tableau_desktop_session_id?: string;
      langsmith_run_id?: string;
    })
  | (EventBase & {
      type: 'episode_end';
      status: EpisodeStatus;
      route_receipt?: RouteReceipt;
      notes?: string;
      langsmith_run_id?: string;
    })
  | (EventBase & {
      type: 'tool_start';
      tool: string;
    })
  | (EventBase & {
      type: 'tool_end';
      tool: string;
      duration_ms: number;
      success: boolean;
    })
  | (EventBase & {
      type: 'tool_error';
      tool: string;
      error?: string;
    })
  | (EventBase & {
      type: 'apply_succeeded';
      tool: string;
      operation: string;
      promise_outcome: PromiseOutcome;
    })
  | (EventBase & {
      type: 'readback_verification';
      tool: string;
      operation: string;
      status: ReadbackVerificationStatus;
      promise_outcome: PromiseOutcome;
      warnings?: number;
      findings?: ReadbackFinding[];
      message?: string;
    });

export type EpisodeEvent = EpisodeEventInput & {
  ts: string;
  seq: number;
};

type CurrentEpisode = {
  episode_id: string;
  session_id: string;
};

const writersByDirectory = new Map<string, FileLogger>();
const currentBySession = new Map<string, CurrentEpisode>();
let seq = 0;
let episodeFileIso: string | undefined;

export async function emitEpisodeEvent(
  config: EpisodeConfig,
  event: EpisodeEventInput,
): Promise<void> {
  if (!config.episodeEventsEnabled) return;
  try {
    const writer = getWriter(config);
    const enriched: EpisodeEvent = {
      ts: new Date().toISOString(),
      seq: ++seq,
      ...event,
    };
    await writer.appendJsonLine(
      getEpisodeFileName(),
      enriched as unknown as Record<string, unknown>,
    );
  } catch {
    // Episode telemetry must never affect product behavior.
  }
}

export async function beginEpisode(
  config: EpisodeConfig,
  {
    sessionId,
    intent,
    tags,
    source = 'agent',
  }: { sessionId: string; intent?: string; tags?: string[]; source?: 'agent' | 'client' | 'auto' },
): Promise<CurrentEpisode> {
  const open = currentBySession.get(sessionId);
  if (open) {
    await closeEpisode(config, open, {
      status: 'abandoned',
      notes: 'auto-closed by tableau-begin-episode',
    });
  }

  const episode: CurrentEpisode = { session_id: sessionId, episode_id: randomUUID() };
  currentBySession.set(sessionId, episode);
  await emitEpisodeEvent(config, {
    type: 'episode_begin',
    session_id: sessionId,
    episode_id: episode.episode_id,
    source,
    ...(intent ? { intent } : {}),
    ...(tags && tags.length > 0 ? { tags } : {}),
    ...episodeBeginFields(config),
  });
  return episode;
}

export async function endEpisode(
  config: EpisodeConfig,
  { sessionId, status, notes }: { sessionId: string; status: EpisodeStatus; notes?: string },
): Promise<CurrentEpisode | undefined> {
  const episode = currentBySession.get(sessionId);
  if (!episode) return undefined;
  await closeEpisode(config, episode, { status, notes });
  return episode;
}

export function currentEpisodeId(sessionId: string | undefined): string | undefined {
  if (!sessionId) return undefined;
  return currentBySession.get(sessionId)?.episode_id;
}

export function episodeSessionIdFromArgs(config: EpisodeConfig, args: unknown): string {
  if (typeof args === 'object' && args !== null) {
    const session = (args as { session?: unknown }).session;
    if (typeof session === 'string' && session.trim()) return session;
  }
  return config.desktopSessionId ?? 'unknown';
}

export async function emitToolErrorEvent({
  config,
  sessionId,
  tool,
  error,
}: {
  config: EpisodeConfig;
  sessionId: string;
  tool: string;
  error: unknown;
}): Promise<void> {
  await emitEpisodeEvent(config, {
    type: 'tool_error',
    session_id: sessionId,
    episode_id: currentEpisodeId(sessionId),
    tool,
    error: getExceptionMessage(error),
  });
}

export async function emitWorksheetPromiseEvents({
  config,
  sessionId,
  tool,
  operation,
  readback,
  findings,
  promiseOutcome,
}: {
  config: EpisodeConfig;
  sessionId: string;
  tool: string;
  operation: string;
  readback: ReadbackVerificationResult | undefined;
  findings: ReadbackFinding[];
  promiseOutcome: PromiseOutcome;
}): Promise<void> {
  const episode_id = currentEpisodeId(sessionId);
  await emitEpisodeEvent(config, {
    type: 'readback_verification',
    session_id: sessionId,
    episode_id,
    tool,
    operation,
    status: readback?.status ?? 'skipped',
    promise_outcome: promiseOutcome,
    warnings: findings.filter((finding) => finding.severity === 'warning').length,
    findings,
    ...(readback?.message ? { message: readback.message } : {}),
  });
  await emitEpisodeEvent(config, {
    type: 'apply_succeeded',
    session_id: sessionId,
    episode_id,
    tool,
    operation,
    promise_outcome: promiseOutcome,
  });
}

export function resetEpisodeEventsForTests(): void {
  writersByDirectory.clear();
  currentBySession.clear();
  seq = 0;
  episodeFileIso = undefined;
}

async function closeEpisode(
  config: EpisodeConfig,
  episode: CurrentEpisode,
  { status, notes }: { status: EpisodeStatus; notes?: string },
): Promise<void> {
  currentBySession.delete(episode.session_id);
  await emitEpisodeEvent(config, {
    type: 'episode_end',
    session_id: episode.session_id,
    episode_id: episode.episode_id,
    status,
    route_receipt: serializeRouteReceipt(sessionRouteState.get(episode.session_id)),
    ...(notes ? { notes } : {}),
    ...langsmithField(),
  });
}

function getWriter(config: EpisodeConfig): FileLogger {
  let writer = writersByDirectory.get(config.episodeEventsDirectory);
  if (!writer) {
    writer = new FileLogger({ logDirectory: config.episodeEventsDirectory });
    writersByDirectory.set(config.episodeEventsDirectory, writer);
  }
  return writer;
}

function getEpisodeFileName(): string {
  episodeFileIso ??= new Date().toISOString();
  return `episodes-${episodeFileIso}.jsonl`;
}

function episodeBeginFields(
  config: EpisodeConfig,
): Omit<
  Extract<EpisodeEventInput, { type: 'episode_begin' }>,
  'type' | 'session_id' | 'episode_id' | 'source' | 'intent' | 'tags'
> {
  return {
    system_prompt_version: process.env.SYSTEM_PROMPT_VERSION || `mcp-server@${pkg.version}`,
    tool_profile: config.toolProfile || undefined,
    agent_types: envList('AGENT_TYPES'),
    tableau_desktop_session_id: config.desktopSessionId,
    ...langsmithField(),
  };
}

function envList(name: string): string[] | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const values = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function langsmithField(): { langsmith_run_id?: string } {
  const langsmithRunId = process.env.LANGSMITH_RUN_ID || process.env.LANGSMITH_TRACE_ID;
  return langsmithRunId ? { langsmith_run_id: langsmithRunId } : {};
}
