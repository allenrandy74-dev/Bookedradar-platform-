import { CONVERSATION_TURN_DETECTION } from './openai-call.js';

// Call acceptance disables barge-in for the welcome. Restore normal conversation
// after playback, with a bounded release if playback events are missing.
export function createGreetingTurnGuard({ send, log, schedule = setTimeout, cancel = clearTimeout, maxMs = 12000 }) {
  let timer, released = false, opened = false, playbackId;
  const greetingIds = new Set();
  function release(reason) {
    if (released) return;
    released = true; cancel(timer);
    send({ type: 'session.update', session: { type: 'realtime', audio: { input: { turn_detection: { ...CONVERSATION_TURN_DETECTION } } } } });
    log('greeting.interruption_restored', { reason });
  }
  return {
    open() {
      if (opened || released) return;
      opened = true;
      // Fully suspend VAD for the opening. Merely setting interrupt_response=false
      // still allows speech-start events and, in production, can coincide with an
      // output buffer clear before the caller hears the greeting.
      send({
        type: 'session.update',
        session: {
          type: 'realtime',
          audio: { input: { turn_detection: null } },
        },
      });
      log('greeting.turn_detection_suspended');
      timer = schedule(() => release('playback_timeout'), maxMs);
      timer?.unref?.();
    },
    event(event) {
      if (released) return;
      if (event.type === 'response.created' && event.response?.metadata?.purpose === 'opening_greeting') greetingIds.add(event.response.id);
      if (event.type === 'output_audio_buffer.started' && greetingIds.has(event.response_id)) playbackId = event.response_id;
      if (playbackId && event.response_id === playbackId && ['output_audio_buffer.stopped', 'output_audio_buffer.cleared'].includes(event.type)) {
        release(event.type === 'output_audio_buffer.stopped' ? 'greeting_completed' : 'greeting_interrupted');
      }
    },
    release,
    stop() { released = true; cancel(timer); },
  };
}

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

// Observe only the opening audio; never collect transcripts or change playback.
export function createOpeningAudioMonitor({ log, now = Date.now }) {
  const startedAt = now(), greetingIds = new Set();
  let closed = false, playbackId, playbackAt, firstAudio = false;
  const emit = (event, fields = {}) => log(`opening.${event}`, { elapsed_ms: now() - startedAt, ...fields });
  return {
    open() { if (!closed) emit('sideband_open'); },
    event(event) {
      if (closed) return;
      if (event.type === 'response.created' && event.response?.metadata?.purpose === 'opening_greeting') {
        greetingIds.add(event.response.id);
        emit('generation_started');
      }
      if (event.type === 'response.done' && greetingIds.has(event.response?.id)) {
        emit('generation_finished', { status: event.response.status || 'unknown' });
      }
      if (event.type === 'input_audio_buffer.speech_started') emit('speech_detected', { during_playback: firstAudio });
      if (event.type === 'output_audio_buffer.started' && !firstAudio) {
        firstAudio = true; playbackId = event.response_id; playbackAt = now();
        emit('playback_started', { identified_greeting: greetingIds.has(playbackId) });
      }
      if (firstAudio && ['output_audio_buffer.stopped', 'output_audio_buffer.cleared'].includes(event.type)
          && (!event.response_id || !playbackId || event.response_id === playbackId)) {
        emit(event.type === 'output_audio_buffer.cleared' ? 'playback_interrupted' : 'playback_completed', { playback_ms: now() - playbackAt });
        closed = true;
      }
    },
    close() {
      if (!closed) emit('connection_closed', { audio_started: firstAudio });
      closed = true;
    },
  };
}
