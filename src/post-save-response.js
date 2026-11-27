import { INTAKE_CONTINUATION_RULES } from './operator.js';

// One follow-up per tool turn. Retry only a completed response that produced
// neither audio nor a tool call.
export function createPostSaveResponse({ send, log = () => {} }) {
  let pending = null, queuedCallback = null, sequence = 0, closed = false;
  function request(saved, retry = false, callbackQuestion = "") {
    if (closed) return;
    const token = String(++sequence);
    const purpose = callbackQuestion ? 'callback_readback' : 'post_save_resume';
    const eventPrefix = callbackQuestion ? 'conversation.callback_readback' : 'conversation.post_save';
    pending = { token, saved, retry, callbackQuestion, eventPrefix, responseId: null, audioStarted: false };
    send({ type: 'response.create', response: {
      output_modalities: ['audio'],
      ...(retry || callbackQuestion ? { tool_choice: 'none' } : {}),
      metadata: { purpose, resume_token: token },
      instructions: callbackQuestion
        ? `Say only this question, reading any telephone digits individually. End the turn immediately after the question. "${callbackQuestion}"`
        : [
        'Resume the service conversation after the capture_lead tool result.',
        saved ? 'The lead save succeeded. This does not confirm an appointment, dispatch, or completed human notification.' : 'The lead save failed. Do not claim the details were saved or delivered.',
        INTAKE_CONTINUATION_RULES,
        'Use the conversation so far and follow the routine intake order above. Ask only the next missing question or give the final invitation when ready. If you have already asked a question and the caller has not answered, wait. The tool result is not an answer.',
        'If the caller clearly indicates they are finished and you have not said goodbye, give the single goodbye above. If you have already said goodbye, remain silent unless the caller starts a new substantive turn.',
        'Do not repeat confirmed details, assume consent, invent information, or announce another delay. Preserve safety priority and explicit requests for human assistance.',
        ...(retry ? ['This is one recovery from an empty response. Speak briefly without invoking another tool. Do not initiate any transfer or booking.'] : []),
      ].join(' '),
    } });
    log(`${eventPrefix}_requested`, { retry, saved });
  }
  return {
    request,
    queueCallback(sourceResponseId, question) {
      if (closed || !sourceResponseId || queuedCallback) return false;
      // A scripted reply must wait until the tool's parent response has finished
      // writing to the conversation.
      queuedCallback = { sourceResponseId, question };
      return true;
    },
    event(event) {
      if (closed) return;
      if (event.type === 'input_audio_buffer.speech_started') {
        pending = null;
        queuedCallback = null;
        return;
      }
      if (event.type === 'response.created') {
        if (queuedCallback?.sourceResponseId !== event.response?.id) queuedCallback = null;
        if (pending && event.response?.metadata?.resume_token === pending.token) pending.responseId = event.response.id;
        else pending = null;
      }
      if (event.type === 'response.done' && queuedCallback && queuedCallback.sourceResponseId === event.response?.id) {
        const { question } = queuedCallback;
        queuedCallback = null;
        if (pending?.responseId === event.response.id) pending = null;
        if (event.response.status === 'completed') request(undefined, false, question);
        return;
      }
      if (!pending) return;
      if (event.type === 'output_audio_buffer.started' && event.response_id === pending?.responseId) pending.audioStarted = true;
      if (event.type !== 'response.done' || !pending || event.response?.id !== pending.responseId) return;
      const current = pending;
      pending = null;
      const response = event.response;
      const output = response.output || [];
      const hasTool = output.some(item => item.type === 'function_call');
      const hasAudio = current.audioStarted || output.some(item => (item.content || []).some(part => ['audio', 'output_audio'].includes(part.type)));
      log(`${current.eventPrefix}_completed`, { status: response.status || 'unknown', has_audio: hasAudio, has_tool: hasTool, retry: current.retry });
      if (response.status === 'completed' && !hasAudio && !hasTool) {
        if (!current.retry) request(current.saved, true, current.callbackQuestion);
        else log(`${current.eventPrefix}_empty_exhausted`);
      }
    },
    stop() { closed = true; pending = null; queuedCallback = null; },
  };
}
