import * as fs from 'fs';
import * as path from 'path';

const MAX_BYTES_PER_FILE = 256 * 1024;
const MAX_BYTES_TOTAL = 1024 * 1024;
const CLOCK_TOLERANCE_MS = 1_000;
const MAX_MESSAGE_LENGTH = 4_096;

type LogFileCursor = {
  path: string;
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
};

export type DesktopLogCursor = {
  pid: number;
  candidateDirs: string[];
  files: LogFileCursor[];
  available: boolean;
};

export type DesktopCommandError = {
  message: string;
  code?: string;
  source: 'tableau-desktop-log';
  logPath: string;
  timestamp: string;
};

export type DesktopCommandErrorRead = {
  detail: DesktopCommandError | null;
  logDetail: 'found' | 'not-found' | 'unavailable';
};

type DesktopLogRecord = {
  ts?: unknown;
  pid?: unknown;
  k?: unknown;
  v?: unknown;
  a?: unknown;
};

type ParsedRecord = {
  record: DesktopLogRecord;
  logPath: string;
  timestamp: string;
  timestampMs: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function listLogFiles(candidateDirs: string[]): {
  files: LogFileCursor[];
  readableDirectory: boolean;
} {
  const files: LogFileCursor[] = [];
  let readableDirectory = false;

  for (const candidateDir of candidateDirs) {
    let names: string[];
    try {
      names = fs.readdirSync(candidateDir);
      readableDirectory = true;
    } catch {
      continue;
    }

    for (const name of names) {
      if (!/^log.*\.txt$/i.test(name)) continue;
      const logPath = path.join(candidateDir, name);
      try {
        const stat = fs.lstatSync(logPath);
        if (!stat.isFile()) continue;
        files.push({
          path: logPath,
          dev: stat.dev,
          ino: stat.ino,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        });
      } catch {
        // Rotation can remove a file between directory listing and stat.
      }
    }
  }

  return { files, readableDirectory };
}

export function snapshotDesktopLogs({
  pid,
  candidateDirs,
}: {
  pid: number;
  candidateDirs: string[];
}): DesktopLogCursor {
  try {
    const { files, readableDirectory } = listLogFiles(candidateDirs);
    return {
      pid,
      candidateDirs: [...candidateDirs],
      files,
      available: readableDirectory && files.length > 0,
    };
  } catch {
    return { pid, candidateDirs: [...candidateDirs], files: [], available: false };
  }
}

function readChangedLines(cursor: DesktopLogCursor): {
  lines: Array<{ line: string; logPath: string }>;
  accessible: boolean;
  readAny: boolean;
} {
  const { files: currentFiles, readableDirectory } = listLogFiles(cursor.candidateDirs);
  if (!readableDirectory || currentFiles.length === 0) {
    return { lines: [], accessible: false, readAny: false };
  }

  const priorByPath = new Map(cursor.files.map((file) => [file.path, file]));
  const priorByIdentity = new Map(cursor.files.map((file) => [`${file.dev}:${file.ino}`, file]));
  const lines: Array<{ line: string; logPath: string }> = [];
  let bytesRemaining = MAX_BYTES_TOTAL;
  let readAny = false;

  for (const current of currentFiles.sort((left, right) => left.mtimeMs - right.mtimeMs)) {
    if (bytesRemaining <= 0) break;
    const atPath = priorByPath.get(current.path);
    const byIdentity = priorByIdentity.get(`${current.dev}:${current.ino}`);
    const prior = atPath?.dev === current.dev && atPath.ino === current.ino ? atPath : byIdentity;

    if (prior && prior.size === current.size && prior.mtimeMs === current.mtimeMs) continue;

    let start = 0;
    if (prior && current.size >= prior.size) {
      start = prior.size;
    } else if (prior || current.size > MAX_BYTES_PER_FILE) {
      start = Math.max(0, current.size - MAX_BYTES_PER_FILE);
    }

    const availableBytes = Math.max(0, current.size - start);
    const length = Math.min(availableBytes, MAX_BYTES_PER_FILE, bytesRemaining);
    if (length === 0) continue;
    if (availableBytes > length) start = current.size - length;

    let fileDescriptor: number | undefined;
    try {
      fileDescriptor = fs.openSync(current.path, 'r');
      const buffer = Buffer.alloc(length);
      const bytesRead = fs.readSync(fileDescriptor, buffer, 0, length, start);
      const text = buffer.subarray(0, bytesRead).toString('utf8');
      readAny = true;
      bytesRemaining -= bytesRead;
      for (const line of text.split('\n')) {
        if (line.trim()) lines.push({ line, logPath: current.path });
      }
    } catch {
      // Diagnostics are best-effort; unreadable files are ignored.
    } finally {
      if (fileDescriptor !== undefined) {
        try {
          fs.closeSync(fileDescriptor);
        } catch {
          // A close failure must not affect command handling.
        }
      }
    }
  }

  return { lines, accessible: true, readAny };
}

function parseTimestamp(value: unknown): { timestamp: string; timestampMs: number } | null {
  if (typeof value !== 'string') return null;
  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) ? { timestamp: value, timestampMs } : null;
}

function commandName(record: DesktopLogRecord): string | null {
  if (!isRecord(record.v)) return null;
  if (typeof record.v.name === 'string') return record.v.name;
  if (typeof record.v.args === 'string') return record.v.args.split(/\s/, 1)[0] || null;
  return null;
}

function invocationId(record: DesktopLogRecord): string | null {
  return isRecord(record.a) && typeof record.a.id === 'string' ? record.a.id : null;
}

function sponsorId(record: DesktopLogRecord): string | null {
  return isRecord(record.a) && typeof record.a.sponsor === 'string' ? record.a.sponsor : null;
}

function boundedMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const message = value.trim().slice(0, MAX_MESSAGE_LENGTH);
  return message || null;
}

function normalizeCode(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const code = String(value).trim().slice(0, 64);
  return code ? code.toUpperCase() : undefined;
}

function errorCodeFromUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return normalizeCode(value.match(/[?&]errorcode=([^&#"\s]+)/i)?.[1]);
}

function quotedArgument(args: string, argumentName: string): string | undefined {
  const escapedName = argumentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return args.match(new RegExp(`(?:^|\\s)${escapedName}="([^"]*)"`))?.[1];
}

export function readDesktopCommandError({
  cursor,
  pid,
  namespace,
  command,
  startedAt,
}: {
  cursor: DesktopLogCursor;
  pid: number;
  namespace: string;
  command: string;
  startedAt: Date;
}): DesktopCommandErrorRead {
  try {
    if (!cursor.available || cursor.pid !== pid) {
      return { detail: null, logDetail: 'unavailable' };
    }

    const changed = readChangedLines(cursor);
    if (!changed.accessible) return { detail: null, logDetail: 'unavailable' };
    if (!changed.readAny) return { detail: null, logDetail: 'not-found' };

    const earliestTimestamp = startedAt.getTime() - CLOCK_TOLERANCE_MS;
    const parsed: ParsedRecord[] = [];
    for (const candidate of changed.lines) {
      try {
        const record = JSON.parse(candidate.line) as DesktopLogRecord;
        if (record.pid !== pid) continue;
        const timestamp = parseTimestamp(record.ts);
        if (!timestamp || timestamp.timestampMs < earliestTimestamp) continue;
        parsed.push({ record, logPath: candidate.logPath, ...timestamp });
      } catch {
        // Ignore malformed and partially flushed JSONL records.
      }
    }

    const targetCommand = `${namespace}:${command}`;
    const commandInvocationIds = new Set<string>();
    for (const candidate of parsed) {
      if (
        candidate.record.k === 'begin-commands-controller.invoke-command' &&
        commandName(candidate.record) === targetCommand
      ) {
        const id = invocationId(candidate.record);
        if (id) commandInvocationIds.add(id);
      }
    }

    let message: string | null = null;
    let code: string | undefined;
    let carrier: ParsedRecord | null = null;

    for (const candidate of parsed) {
      const { record } = candidate;
      if (
        record.k === 'msg' &&
        typeof record.v === 'string' &&
        record.v.includes(`Error in parameters for command '${command}'`)
      ) {
        const nextMessage = boundedMessage(record.v);
        if (nextMessage) {
          message = nextMessage;
          carrier = candidate;
        }
        continue;
      }

      if (record.k === 'detailed-error-msg' && isRecord(record.v)) {
        const nextMessage = boundedMessage(record.v.shortMessage);
        if (nextMessage?.includes(command)) {
          message ??= nextMessage;
          carrier ??= candidate;
          code ??= errorCodeFromUrl(record.v.supportUrl ?? record.v.helpLink);
        }
        continue;
      }

      if (record.k === 'end-commands-controller.invoke-command' && isRecord(record.a)) {
        const belongsToCommand =
          commandName(record) === targetCommand ||
          commandInvocationIds.has(invocationId(record) ?? '') ||
          commandInvocationIds.has(sponsorId(record) ?? '');
        const returnValue = isRecord(record.a.rv) ? record.a.rv : null;
        const nextMessage = boundedMessage(returnValue?.msg);
        if (belongsToCommand && nextMessage) {
          message ??= nextMessage;
          carrier ??= candidate;
          code ??= normalizeCode(returnValue?.['e-code']);
        }
        continue;
      }

      if (
        record.k === 'begin-commands-controller.invoke-command' &&
        commandName(record) === 'tabdoc:show-detailed-error-dialog' &&
        commandInvocationIds.has(sponsorId(record) ?? '') &&
        isRecord(record.v) &&
        typeof record.v.args === 'string'
      ) {
        const nextMessage = boundedMessage(quotedArgument(record.v.args, 'error-short-message'));
        if (nextMessage) {
          message ??= nextMessage;
          carrier ??= candidate;
        }
        code ??= errorCodeFromUrl(quotedArgument(record.v.args, 'error-help-link'));
      }
    }

    if (!message || !carrier) return { detail: null, logDetail: 'not-found' };
    return {
      detail: {
        message,
        ...(code ? { code } : {}),
        source: 'tableau-desktop-log',
        logPath: carrier.logPath,
        timestamp: carrier.timestamp,
      },
      logDetail: 'found',
    };
  } catch {
    return { detail: null, logDetail: 'unavailable' };
  }
}
