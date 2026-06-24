// SSE-over-POST client.
//
// EventSource is GET-only — our backend endpoints take JSON bodies, so we
// fetch() with stream=true and hand-parse the wire format. Frames are
// separated by double newlines; lines starting with `event:` / `data:` are
// extracted, multi-line `data:` is concatenated by spec.
//
// One stream() call drives one route. Returns an `abort()` you can wire to
// useEffect cleanup so unmounting cancels the in-flight request cleanly.

import { API_BASE } from "./api";
import { authHeaders } from "./token";

export interface SSEHandlers {
  /** Called once per fully-assembled SSE frame, with parsed JSON `data`. */
  onEvent: (event: string, data: any) => void;
  /** Network/parse failure or non-2xx response. The stream is already closed. */
  onError?: (err: Error) => void;
  /** Stream ended naturally (server closed). Not called on abort/error. */
  onDone?: () => void;
}

export interface SSEController {
  /** Cancel the request. Idempotent. */
  abort: () => void;
}

interface SSEFrame {
  event: string;
  dataLines: string[];
}

function* parseFrames(buffer: { value: string }): Generator<SSEFrame> {
  // Split on a blank line (CRLF tolerant). Keep any trailing partial frame
  // in the buffer for the next chunk.
  while (true) {
    const sep = buffer.value.search(/\r?\n\r?\n/);
    if (sep < 0) return;
    const raw = buffer.value.slice(0, sep);
    // advance past the separator
    const after = buffer.value.slice(sep).match(/^\r?\n\r?\n/)![0].length;
    buffer.value = buffer.value.slice(sep + after);

    let event = "message";
    const dataLines: string[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.startsWith(":")) continue; // comment / heartbeat
      const idx = line.indexOf(":");
      const field = idx < 0 ? line : line.slice(0, idx);
      // Per spec, an optional space after the colon is stripped.
      let value = idx < 0 ? "" : line.slice(idx + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") event = value;
      else if (field === "data") dataLines.push(value);
      // ignore id / retry — we don't need reconnection semantics
    }
    if (dataLines.length === 0) continue;
    yield { event, dataLines };
  }
}

export function streamSSE(
  path: string,
  body: unknown,
  handlers: SSEHandlers
): SSEController {
  const controller = new AbortController();
  let aborted = false;

  (async () => {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Hint to any intermediary not to buffer
          Accept: "text/event-stream",
          // Bearer token (when signed in) so the run is saved to history.
          ...authHeaders(),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e: unknown) {
      if (!aborted) handlers.onError?.(toError(e));
      return;
    }

    if (!response.ok) {
      // Body is JSON for our handler errors (400/429/502)
      let detail = `HTTP ${response.status}`;
      try {
        const j = await response.json();
        if (j?.detail) detail = j.detail;
      } catch {}
      handlers.onError?.(new Error(detail));
      return;
    }

    if (!response.body) {
      handlers.onError?.(new Error("response has no body"));
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    const buffer = { value: "" };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer.value += decoder.decode(value, { stream: true });
        for (const frame of parseFrames(buffer)) {
          const joined = frame.dataLines.join("\n");
          let parsed: any = joined;
          try {
            parsed = JSON.parse(joined);
          } catch {
            // leave as raw string if not JSON; our backend always sends JSON
          }
          handlers.onEvent(frame.event, parsed);
        }
      }
      // flush trailing buffer (rare — backend ends with double newline)
      buffer.value += decoder.decode();
      for (const frame of parseFrames(buffer)) {
        const joined = frame.dataLines.join("\n");
        let parsed: any = joined;
        try {
          parsed = JSON.parse(joined);
        } catch {}
        handlers.onEvent(frame.event, parsed);
      }
      handlers.onDone?.();
    } catch (e: unknown) {
      if (!aborted) handlers.onError?.(toError(e));
    }
  })();

  return {
    abort: () => {
      aborted = true;
      controller.abort();
    },
  };
}

function toError(e: unknown): Error {
  if (e instanceof Error) return e;
  return new Error(String(e));
}
