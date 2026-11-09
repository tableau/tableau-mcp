import { Readable } from 'stream';

import { SseParser } from '../../../utils/sse.js';
import {
  CabuResponseCompleteEvent,
  cabuResponseCompleteEventSchema,
  CabuStreamErrorEvent,
  cabuStreamErrorEventSchema,
} from '../types/cabu.js';

export type CabuStreamResult =
  | { status: 'complete'; responseComplete?: CabuResponseCompleteEvent }
  | { status: 'error'; error: CabuStreamErrorEvent }
  | { status: 'incomplete'; responseComplete?: CabuResponseCompleteEvent };

/**
 * Drains CABU's `/stream` SSE body to its terminal event. Event order is `traceId` →
 * `classification_complete`(?) → `reasoning_complete` → `action_complete` → `response_complete`
 * → terminal `complete` (`{}`) or `error` -- see `.work/specs/W-24280234-cabu-tools.md`. Only
 * `response_complete` (the answer payload) and the terminal events are parsed; the progress
 * events are drained and otherwise ignored, matching the CES `ResponseNode`/`ResponseFormatter`
 * contract that `response_complete` already carries the fully-assembled answer.
 *
 * A stream that ends (`end`) without ever seeing `complete`/`error` resolves `status: 'incomplete'`
 * rather than rejecting -- there is no protocol error to report, just an answer the caller should
 * treat as unconfirmed. A transport-level failure (`error` on the stream itself -- an abort, a
 * socket reset) rejects the returned promise instead, since that is a real request failure.
 *
 * `timeoutMs` bounds the whole drain, separately from axios's own `timeout` on the originating
 * request: for a `responseType: 'stream'` request, axios's `timeout` only covers the wait for the
 * response to start, not the time spent reading the body, so a CES turn that starts streaming and
 * then stalls would otherwise hang forever -- see `.work/specs/W-24280234-cabu-tools.md`. A stall is
 * treated the same as a clean `end` with no terminal event: `status: 'incomplete'`, not a rejection.
 */
export function drainSseStream(stream: Readable, timeoutMs: number): Promise<CabuStreamResult> {
  return new Promise((resolve, reject) => {
    const parser = new SseParser();
    let responseComplete: CabuResponseCompleteEvent | undefined;
    let settled = false;

    const finish = (result: CabuStreamResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      stream.removeAllListeners('data');
      stream.removeAllListeners('end');
      stream.removeAllListeners('error');
      stream.destroy();
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ status: 'incomplete', responseComplete });
    }, timeoutMs);

    stream.on('data', (chunk: Buffer | string) => {
      if (settled) {
        return;
      }
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      for (const event of parser.push(text)) {
        if (event.event === 'response_complete') {
          try {
            responseComplete = cabuResponseCompleteEventSchema.parse(JSON.parse(event.data));
          } catch {
            // Malformed response_complete payload: keep draining and let the terminal event
            // decide the outcome, rather than failing the whole turn on a parse error.
          }
        } else if (event.event === 'complete') {
          finish({ status: 'complete', responseComplete });
          return;
        } else if (event.event === 'error') {
          let error: CabuStreamErrorEvent = {};
          try {
            error = cabuStreamErrorEventSchema.parse(JSON.parse(event.data));
          } catch {
            // Malformed error payload: surface an empty error object rather than throwing.
          }
          finish({ status: 'error', error });
          return;
        }
        // Other named events (traceId, classification_complete, reasoning_complete,
        // action_complete) are intentionally drained, not parsed -- see cabu.ts's doc comment.
      }
    });

    stream.on('end', () => {
      finish({ status: 'incomplete', responseComplete });
    });

    stream.on('error', (err: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(err);
    });
  });
}
