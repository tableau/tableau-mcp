/**
 * Shared final-text extraction for coding-agent CLIs that emit either a single
 * JSON object (`--output-format json`) or newline-delimited stream-json events
 * (`--output-format stream-json`). Claude Code and Cursor share this exact logic;
 * Codex uses a structurally different event shape and keeps its own extractor.
 *
 * Extracted verbatim from the claude-code adapter (the more defensive of the two
 * near-identical copies).
 */

export function extractFinalTextFromStreamJson(stdout: string): string {
  // Headless judge uses --output-format json → a single JSON object with `.result`.
  const trimmed = stdout.trim();
  try {
    const obj = JSON.parse(trimmed) as { result?: string; text?: string };
    if (typeof obj.result === 'string') return obj.result;
    if (typeof obj.text === 'string') return obj.text;
  } catch {
    // Fall through to stream-json line scan.
  }
  // stream-json fallback: last assistant text / result event.
  const lines = trimmed.split('\n').filter((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const ev = JSON.parse(lines[i]) as {
        type?: string;
        result?: string;
        message?: { content?: Array<{ type?: string; text?: string }> | string };
      };
      if (ev.type === 'result' && typeof ev.result === 'string') return ev.result;
      const content = ev.message?.content;
      if (Array.isArray(content)) {
        const text = content
          .filter((b) => b.type === 'text' && b.text)
          .map((b) => b.text)
          .join('\n');
        if (text) return text;
      } else if (typeof content === 'string' && content.trim()) {
        return content;
      }
    } catch {
      continue;
    }
  }
  return trimmed;
}
