import { z } from 'zod';

export const PERFORMANCE_PROMPT =
  'Optimize the open workbook for performance. Before analysis, call start-performance-recording. Inspect the workbook, make or recommend a concrete performance optimization and verify the result, then call stop-performance-recording and report its filePath.';

export const START_TOOL = 'start-performance-recording';
export const STOP_TOOL = 'stop-performance-recording';
export const SUMMARY_TOOL = 'get-summary-data';
export const START_ROUTE = '/v0/workbook:startPerformanceRecording';
export const STOP_ROUTE = '/v0/workbook:stopPerformanceRecording';
export const COMPOSER_SELECTOR = '[data-tb-test-id="User-Input-Text-Area-TextArea"]';
export const SEND_SELECTOR = '[data-tb-test-id="User-Input-Send-Button"]';
export const STOP_SELECTOR = '[data-tb-test-id="User-Input-Cancel-Button"]';

const McpContentSchema = z
  .object({
    type: z.string(),
    text: z.string().optional(),
  })
  .passthrough();

export const McpToolResultSchema = z
  .object({
    content: z.array(McpContentSchema),
    isError: z.boolean().optional(),
    structuredContent: z.unknown().optional(),
  })
  .passthrough();

export const AgentFrameSchema = z.object({ type: z.string() }).passthrough();

export type AgentFrame = z.infer<typeof AgentFrameSchema>;

export type AgentSequenceEvidence = {
  success: boolean;
  errors: string[];
  startUseIndex?: number;
  startResultIndex?: number;
  stopUseIndex?: number;
  stopResultIndex?: number;
  terminalIndex?: number;
  filePath?: string;
};

export type LogEvidence = {
  success: boolean;
  errors: string[];
  observedIsoTimestamps: string[];
};

export type UiReportEvidence = {
  success: boolean;
  errors: string[];
  transcript?: string;
  filePath?: string;
};

const SECRET_KEY =
  /(authorization|proxy-authorization|token|access[_-]?token|refresh[_-]?token|api[_-]?key|pat[_-]?(?:name|value)|password|secret)/i;

/** Redact common credentials without changing non-secret evidence such as paths and PIDs. */
export function redactSecrets(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
      .replace(/\b(sk-ant-|sk-)[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
      .replace(
        /("(?:authorization|proxy-authorization|token|access[_-]?token|refresh[_-]?token|api[_-]?key|pat[_-]?(?:name|value)|password|secret)"\s*:\s*)"(?:\\.|[^"\\])*"/gi,
        '$1"[REDACTED]"',
      )
      .replace(
        /((?:authorization|proxy-authorization|token|access[_-]?token|refresh[_-]?token|api[_-]?key|pat[_-]?(?:name|value)|password|secret)\s*[=:]\s*)[^\s,;]+/gi,
        '$1[REDACTED]',
      );
  }
  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        SECRET_KEY.test(key) ? '[REDACTED]' : redactSecrets(nested),
      ]),
    );
  }
  return value;
}

export function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export function mcpResultText(value: unknown): string {
  const result = McpToolResultSchema.parse(value);
  return result.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text ?? '')
    .join('\n');
}

export function assertSuccessfulMcpResult(value: unknown, toolName: string): string {
  const result = McpToolResultSchema.parse(value);
  const text = mcpResultText(result);
  if (result.isError) {
    throw new Error(`${toolName} returned isError=true: ${text}`);
  }
  return text;
}

function findStringProperty(value: unknown, propertyName: string): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringProperty(item, propertyName);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  for (const [key, nested] of Object.entries(value)) {
    if (key === propertyName && typeof nested === 'string' && nested.trim()) {
      return nested.trim();
    }
    const found = findStringProperty(nested, propertyName);
    if (found) return found;
  }
  return undefined;
}

export function extractFilePath(value: unknown): string | undefined {
  const direct = findStringProperty(value, 'filePath');
  if (direct) return direct;

  if (typeof value === 'string') {
    const parsed = parseJsonObject(value);
    if (parsed) {
      const nested = findStringProperty(parsed, 'filePath');
      if (nested) return nested;
    }
    const quoted = value.match(/["']([^"'\r\n]+\.twbx)["']/i);
    if (quoted?.[1]) return quoted[1];
    const windows = value.match(/([A-Za-z]:\\[^\r\n"']+?\.twbx)\b/i);
    if (windows?.[1]) return windows[1];
    const posix = value.match(/(\/[^\r\n"']+?\.twbx)\b/i);
    if (posix?.[1]) return posix[1];
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractFilePath(item);
      if (found) return found;
    }
  } else if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) {
      const found = extractFilePath(nested);
      if (found) return found;
    }
  }
  return undefined;
}

export function toolNameMatches(observed: unknown, expected: string): boolean {
  if (typeof observed !== 'string') return false;
  const normalized = observed.toLowerCase().replaceAll('_', '-');
  return normalized === expected || normalized.endsWith(`-${expected}`);
}

export function analyzeAgentFrames(rawFrames: readonly unknown[]): AgentSequenceEvidence {
  const errors: string[] = [];
  const frames: AgentFrame[] = [];
  rawFrames.forEach((raw, index) => {
    const parsed = AgentFrameSchema.safeParse(raw);
    if (parsed.success) frames.push(parsed.data);
    else errors.push(`frame ${index} is not a valid agent frame`);
  });

  const findUse = (toolName: string, after = -1): number =>
    frames.findIndex(
      (frame, index) =>
        index > after && frame.type === 'tool_use' && toolNameMatches(frame.toolName, toolName),
    );
  const findResult = (useIndex: number): number => {
    if (useIndex < 0) return -1;
    const toolId = frames[useIndex].toolId;
    return frames.findIndex(
      (frame, index) =>
        index > useIndex &&
        frame.type === 'tool_result' &&
        (typeof toolId !== 'string' || frame.toolUseId === toolId),
    );
  };

  const startUseIndex = findUse(START_TOOL);
  const startResultIndex = findResult(startUseIndex);
  const stopUseIndex = findUse(STOP_TOOL, Math.max(startUseIndex, startResultIndex));
  const stopResultIndex = findResult(stopUseIndex);
  const terminalIndex = frames.findIndex(
    (frame, index) => index > stopResultIndex && frame.type === 'result',
  );

  if (startUseIndex < 0) errors.push(`missing ${START_TOOL} tool_use`);
  if (startResultIndex < 0) errors.push(`missing ${START_TOOL} tool_result`);
  if (startResultIndex >= 0 && frames[startResultIndex].isError === true) {
    errors.push(`${START_TOOL} tool_result reported an error`);
  }
  if (stopUseIndex < 0) errors.push(`missing ordered ${STOP_TOOL} tool_use`);
  if (stopResultIndex < 0) errors.push(`missing ${STOP_TOOL} tool_result`);
  if (stopResultIndex >= 0 && frames[stopResultIndex].isError === true) {
    errors.push(`${STOP_TOOL} tool_result reported an error`);
  }
  if (frames.some((frame) => frame.type === 'agent_error')) {
    errors.push('agent emitted agent_error');
  }
  if (terminalIndex < 0) {
    errors.push('missing terminal result after recorder stop');
  } else if (frames[terminalIndex].success !== true) {
    errors.push('terminal result did not report success=true');
  }

  const filePath =
    stopResultIndex >= 0 ? extractFilePath(frames[stopResultIndex].content) : undefined;
  if (!filePath) errors.push(`${STOP_TOOL} result did not expose filePath`);

  return {
    success: errors.length === 0,
    errors,
    ...(startUseIndex >= 0 ? { startUseIndex } : {}),
    ...(startResultIndex >= 0 ? { startResultIndex } : {}),
    ...(stopUseIndex >= 0 ? { stopUseIndex } : {}),
    ...(stopResultIndex >= 0 ? { stopResultIndex } : {}),
    ...(terminalIndex >= 0 ? { terminalIndex } : {}),
    ...(filePath ? { filePath } : {}),
  };
}

function observedIsoTimestamps(text: string): string[] {
  return Array.from(
    text.matchAll(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g),
    (match) => match[0],
  );
}

export function validateLogEvidence(args: {
  mcpLog: string;
  desktopLog: string;
  startedAtMs: number;
  finishedAtMs: number;
}): LogEvidence {
  const errors: string[] = [];
  const timestamps = observedIsoTimestamps(args.mcpLog);
  if (!args.mcpLog.includes(START_TOOL)) errors.push(`MCP log is missing ${START_TOOL}`);
  if (!args.mcpLog.includes(STOP_TOOL)) errors.push(`MCP log is missing ${STOP_TOOL}`);
  if (!args.desktopLog.includes(START_ROUTE))
    errors.push(`Desktop log slice is missing ${START_ROUTE}`);
  if (!args.desktopLog.includes(STOP_ROUTE))
    errors.push(`Desktop log slice is missing ${STOP_ROUTE}`);
  const correlated = timestamps.some((timestamp) => {
    const value = Date.parse(timestamp);
    return value >= args.startedAtMs - 60_000 && value <= args.finishedAtMs + 60_000;
  });
  if (!correlated) errors.push('MCP log has no timestamp correlated to the scenario window');
  return { success: errors.length === 0, errors, observedIsoTimestamps: timestamps };
}

type CdpReport = {
  url?: unknown;
  screenshotDir?: unknown;
  results?: unknown;
  consoleErrors?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function validateUiCdpReport(raw: unknown, prompt = PERFORMANCE_PROMPT): UiReportEvidence {
  const errors: string[] = [];
  if (!isRecord(raw)) return { success: false, errors: ['CDP report is not an object'] };
  const report = raw as CdpReport;
  const url = typeof report.url === 'string' ? report.url : '';
  if (!url.endsWith('/#live-dev')) errors.push(`unexpected UI URL: ${url || '(missing)'}`);
  if (url.includes('mock-stream') || url.includes('static-chat')) {
    errors.push('UI report used a mock/static stream URL');
  }
  const consoleErrors = Array.isArray(report.consoleErrors) ? report.consoleErrors : [];
  if (consoleErrors.length > 0)
    errors.push(`browser console reported ${consoleErrors.length} error(s)`);
  const results = Array.isArray(report.results) ? report.results.filter(isRecord) : [];
  if (!Array.isArray(report.results)) errors.push('CDP report is missing results');

  const shots = new Set(
    results
      .map((result) => result.shot)
      .filter((shot): shot is string => typeof shot === 'string')
      .map((shot) => shot.replaceAll('\\', '/').split('/').at(-1)),
  );
  for (const required of ['before.png', 'submitted.png', 'completed.png']) {
    if (!shots.has(required)) errors.push(`CDP report is missing ${required}`);
  }

  const evaluatedValues = results
    .filter((result) => typeof result.eval === 'string')
    .map((result) => result.value);
  const composer = evaluatedValues.find(
    (value) => isRecord(value) && value.phase === 'composer-filled',
  );
  if (!isRecord(composer) || composer.ok !== true || composer.text !== prompt) {
    errors.push('composer was not visibly filled with the exact shared prompt');
  }
  const submitted = evaluatedValues.find(
    (value) => isRecord(value) && value.phase === 'prompt-submitted',
  );
  if (!isRecord(submitted) || submitted.ok !== true)
    errors.push('prompt submission was not confirmed');
  const stopSeen = evaluatedValues.find(
    (value) => isRecord(value) && value.phase === 'stop-selector-seen',
  );
  if (!isRecord(stopSeen) || stopSeen.ok !== true)
    errors.push('streaming stop selector was never observed');
  const completed = evaluatedValues.find(
    (value) => isRecord(value) && value.phase === 'turn-completed',
  );
  if (!isRecord(completed) || completed.ok !== true)
    errors.push('send selector did not return after streaming');
  const transcriptValue = evaluatedValues.find(
    (value) => isRecord(value) && value.phase === 'transcript',
  );
  const transcript =
    isRecord(transcriptValue) && typeof transcriptValue.text === 'string'
      ? transcriptValue.text
      : undefined;
  if (!transcript || !transcript.includes(prompt)) {
    errors.push('completed UI transcript does not contain the submitted prompt');
  }
  const filePath = transcript ? extractFilePath(transcript) : undefined;
  if (!filePath) errors.push('completed UI transcript does not report recorder filePath');

  return {
    success: errors.length === 0,
    errors,
    ...(transcript ? { transcript } : {}),
    ...(filePath ? { filePath } : {}),
  };
}

export function aggregateFailures(
  scenarios: readonly { name: string; success: boolean; errors?: readonly string[] }[],
): string[] {
  return scenarios.flatMap((scenario) =>
    scenario.success
      ? []
      : scenario.errors?.length
        ? scenario.errors.map((error) => `${scenario.name}: ${error}`)
        : [`${scenario.name}: failed without a diagnostic`],
  );
}

export async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs} ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
