export type SseEvent = {
  event: string;
  data: string;
};

/**
 * Incremental parser for a `text/event-stream` body (SSE), fed one chunk at a time as it arrives
 * off a streaming HTTP response. Chunk boundaries never align with record boundaries, so the
 * parser buffers partial input across `push()` calls and only emits a record once its terminating
 * blank line has been seen.
 *
 * Supports the subset of the SSE spec CABU's `/stream` endpoint actually uses: `event:` and
 * `data:` fields, multi-line `data:` joined with `\n` per spec, and `:`-prefixed comment lines
 * ignored. `id:`/`retry:` are not supported — nothing in this codebase's CABU usage sends them.
 */
export class SseParser {
  private buffer = '';

  push(chunk: string): Array<SseEvent> {
    this.buffer += chunk;

    const events: Array<SseEvent> = [];
    let boundary = this.buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const record = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const parsed = parseRecord(record);
      if (parsed) {
        events.push(parsed);
      }
      boundary = this.buffer.indexOf('\n\n');
    }

    return events;
  }
}

function parseRecord(record: string): SseEvent | undefined {
  let event: string | undefined;
  const dataLines: Array<string> = [];

  for (const line of record.split('\n')) {
    if (line.startsWith(':')) {
      continue;
    }
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trimStart();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return undefined;
  }

  return { event: event ?? 'message', data: dataLines.join('\n') };
}
