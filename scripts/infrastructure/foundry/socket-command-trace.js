export const NOOP_SOCKET_COMMAND_TRACE = () => {};

function finiteTimestamp(value, fallback) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) ? timestamp : fallback();
}

function positiveCount(value) {
  const count = Number(value ?? 1);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function traceKey(event) {
  const command = String(event?.command ?? "").trim();
  const requestId = String(event?.requestId ?? "").trim();
  const senderId = String(event?.senderId ?? "").trim();
  return command && requestId && senderId
    ? { key: `${senderId}\0${command}\0${requestId}`, command, requestId, senderId }
    : null;
}

export function createSocketCommandTraceSink({
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  onRecord = () => {},
  warn = (record) => console.warn("Rebreya slow socket command", record),
  slowTotalMs = 1_000,
  slowQueueMs = 250,
  maxOpenSpans = 512
} = {}) {
  if (typeof now !== "function" || typeof onRecord !== "function" || typeof warn !== "function") {
    throw new TypeError("Socket command trace callbacks must be functions");
  }
  if (!Number.isInteger(maxOpenSpans) || maxOpenSpans < 1) {
    throw new TypeError("maxOpenSpans must be a positive integer");
  }

  const spans = new Map();
  return (event) => {
    const correlation = traceKey(event);
    if (!correlation) return;

    const phase = String(event?.phase ?? "");
    const at = finiteTimestamp(event?.at, now);
    let span = spans.get(correlation.key);
    if (!span) {
      if (phase !== "received") return;
      span = {
        command: correlation.command,
        requestId: correlation.requestId,
        senderId: correlation.senderId,
        receivedAt: at,
        journalWrites: 0,
        documentWrites: 0
      };
      spans.set(correlation.key, span);
      while (spans.size > maxOpenSpans) {
        spans.delete(spans.keys().next().value);
      }
      return;
    }

    if (phase === "validated") span.validatedAt = at;
    if (phase === "accepted") span.acceptedAt = at;
    if (phase === "queue-start") span.queueStartedAt = at;
    if (phase === "authorized") span.authorizedAt = at;
    if (phase === "execute-end") span.executeEndedAt = at;
    if (phase === "response") span.responseAt = at;
    if (phase === "journal-write") span.journalWrites += positiveCount(event.count);
    if (phase === "document-write") span.documentWrites += positiveCount(event.count);
    if (phase === "refresh-scheduled") span.refreshScheduledAt = at;
    if (phase !== "completed") return;

    spans.delete(correlation.key);
    const queueBaseAt = span.acceptedAt ?? span.receivedAt;
    const queueStartedAt = span.queueStartedAt ?? queueBaseAt;
    const executionStartedAt = span.authorizedAt ?? queueStartedAt;
    const executeEndedAt = span.executeEndedAt ?? at;
    const responseAt = span.responseAt ?? at;
    const record = Object.freeze({
      command: span.command,
      requestId: span.requestId,
      senderId: span.senderId,
      outcome: String(event?.outcome ?? "unknown"),
      mode: String(event?.mode ?? "unknown"),
      keys: Object.freeze((event?.keys ?? []).map((key) => String(key))),
      receivedAt: span.receivedAt,
      validatedAt: span.validatedAt,
      acceptedAt: span.acceptedAt,
      queueStartedAt,
      authorizedAt: span.authorizedAt,
      executeEndedAt,
      responseAt,
      completedAt: at,
      validationMs: span.validatedAt == null
        ? undefined
        : Math.max(0, span.validatedAt - span.receivedAt),
      acceptanceMs: span.acceptedAt == null
        ? undefined
        : Math.max(0, span.acceptedAt - span.receivedAt),
      queueMs: Math.max(0, queueStartedAt - queueBaseAt),
      authorizationMs: span.authorizedAt == null
        ? undefined
        : Math.max(0, span.authorizedAt - queueStartedAt),
      executionMs: Math.max(0, executeEndedAt - executionStartedAt),
      responseMs: Math.max(0, responseAt - executeEndedAt),
      totalMs: Math.max(0, at - span.receivedAt),
      journalWrites: span.journalWrites,
      documentWrites: span.documentWrites,
      refreshScheduledAt: span.refreshScheduledAt
    });
    onRecord(record);
    if (
      record.outcome !== "ok"
      || record.totalMs >= slowTotalMs
      || record.queueMs >= slowQueueMs
    ) {
      warn(record);
    }
  };
}
