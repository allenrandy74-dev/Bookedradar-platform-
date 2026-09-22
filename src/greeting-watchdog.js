/** Observes SIP playback, not text generation or response.created. */
export function createGreetingWatchdog({ send, businessName, log, fallback,
  timeoutMs = 4000, schedule = setTimeout, cancel = clearTimeout, now = Date.now }) {
  let timer, stopped = false, requested = false, retried = false, startedAt = now();
  let responseId = null;
  function arm() { timer = schedule(expire, timeoutMs); timer?.unref?.(); }
  function request(retry) {
    if (stopped) return;
    requested = true;
    log(retry ? 'greeting.retry' : 'greeting.requested');
    if (retry && responseId) send({ type: 'response.cancel', response_id: responseId });
    send({ type: 'response.create', response: {
      output_modalities: ['audio'], tool_choice: 'none',
      metadata: { purpose: 'opening_greeting' },
      instructions: `Say exactly: "Thank you for calling ${businessName}. How can I help you today?" Then stop and listen.`,
    }});
    arm();
  }
  async function expire() {
    if (stopped) return;
    if (!retried) { retried = true; request(true); return; }
    stopped = true;
    log('greeting.failed', { elapsed_ms: now() - startedAt });
    try {
      const result = await fallback();
      log('greeting.fallback', { outcome: result || 'requested' });
    } catch {
      log('greeting.fallback', { outcome: 'failed' });
    }
  }
  // Start timing immediately after accept, including a stalled WebSocket handshake.
  arm();
  return {
    open() { if (!requested && !stopped) { cancel(timer); request(false); } },
    event(event) {
      if (stopped) return;
      if (event.type === 'response.created') responseId = event.response?.id || null;
      if (event.type === 'response.done' && event.response?.id === responseId) responseId = null;
      if (event.type === 'output_audio_buffer.started') {
        stopped = true; cancel(timer);
        log('greeting.first_audio', { elapsed_ms: now() - startedAt, retried });
      }
    },
    stop() { stopped = true; cancel(timer); },
  };
}
