// Recover only an empty, completed response requested after capture_lead.
// This is not an idle timer: normal confirmation waits must remain silent.
export function createPostSaveResponse({ send, log = () => {} }) {
  let pending = null, sequence = 0, closed = false;
  function request(saved, retry = false) {
    if (closed) return;
    const token = String(++sequence);
    pending = { token, saved, retry, responseId: null, audioStarted: false };
    send({ type: 'response.create', response: {
      output_modalities: ['audio'],
      ...(retry ? { tool_choice: 'none' } : {}),
      metadata: { purpose: 'post_save_resume', resume_token: token },
      instructions: [
        'Resume the service conversation after the capture_lead tool result.',
        saved ? 'The lead save succeeded. This does not confirm an appointment, dispatch, or completed human notification.' : 'The lead save failed. Do not claim the details were saved or delivered.',
        'A saving announcement such as getting the details lined up must be followed by a useful spoken next step, not silence.',
        'Use the conversation so far. If you already asked a question and the caller has not answered, briefly repeat only that pending question, then stop and wait. Do not treat the tool result as their answer.',
        'Otherwise ask only the next missing intake or confirmation question; if all required details are already confirmed, continue the normal closing invitation. If the caller already said goodbye, give only a brief goodbye.',
        'Do not repeat confirmed details, assume consent, invent information, or announce another delay. Preserve safety priority and explicit requests for human assistance.',
        ...(retry ? ['This is one recovery from an empty response. Speak briefly without invoking another tool. Do not initiate any transfer or booking.'] : []),
      ].join(' '),
    } });
    log('conversation.post_save_requested', { retry, saved });
  }
  return {
    request,
    event(event) {
      if (!pending || closed) return;
      // A new caller turn or unrelated response supersedes this recovery.
      if (event.type === 'input_audio_buffer.speech_started') { pending = null; return; }
      if (event.type === 'response.created') {
        if (event.response?.metadata?.resume_token !== pending.token) { pending = null; return; }
        pending.responseId = event.response.id;
      }
      if (event.type === 'output_audio_buffer.started' && event.response_id === pending?.responseId) pending.audioStarted = true;
      if (event.type !== 'response.done' || !pending || event.response?.id !== pending.responseId) return;
      const current = pending;
      pending = null;
      const response = event.response;
      const output = response.output || [];
      const hasTool = output.some(item => item.type === 'function_call');
      const hasAudio = current.audioStarted || output.some(item => (item.content || []).some(part => ['audio', 'output_audio'].includes(part.type)));
      log('conversation.post_save_completed', { status: response.status || 'unknown', has_audio: hasAudio, has_tool: hasTool, retry: current.retry });
      if (response.status === 'completed' && !hasAudio && !hasTool) {
        if (!current.retry) request(current.saved, true);
        else log('conversation.post_save_empty_exhausted');
      }
    },
    stop() { closed = true; pending = null; },
  };
}
