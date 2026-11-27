import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPostSaveResponse } from '../src/post-save-response.js';
import { INTAKE_CONTINUATION_RULES, routineCallbackQuestion } from '../src/operator.js';
import { competitiveFeaturesForTenant } from '../src/competitive-features.js';
function fixture() {
  const sent = [], logs = [];
  const guard = createPostSaveResponse({ send: e => sent.push(e), log: (e, fields) => logs.push({ e, ...fields }) });
  function created(id = 'r1') {
    guard.event({ type: 'response.created', response: { id, metadata: sent.at(-1).response.metadata } });
  }
  function done(output = [], status = 'completed', id = 'r1') {
    guard.event({ type: 'response.done', response: { id, status, output } });
  }
  return { guard, sent, logs, created, done };
}
test('completed empty post-save response retries once with audio and tools disabled', () => {
  const f = fixture(); f.guard.request(true); f.created(); f.done();
  assert.equal(f.sent.length, 2);
  assert.deepEqual(f.sent[1].response.output_modalities, ['audio']);
  assert.equal(f.sent[1].response.tool_choice, 'none');
  f.created('r2'); f.done([], 'completed', 'r2');
  assert.equal(f.sent.length, 2);
  assert.ok(f.logs.some(x => x.e === 'conversation.post_save_empty_exhausted'));
});
test('audio content suppresses retry even when SIP playback starts after response.done', () => {
  const f = fixture(); f.guard.request(true); f.created();
  f.done([{ type: 'message', content: [{ type: 'audio', transcript: 'What time works?' }] }]);
  assert.equal(f.sent.length, 1);
});
test('actual playback suppresses retry if completed output is missing', () => {
  const f = fixture(); f.guard.request(true); f.created();
  f.guard.event({ type: 'output_audio_buffer.started', response_id: 'r1' }); f.done();
  assert.equal(f.sent.length, 1);
});
test('tool-only responses defer to the tool handler without duplicate recovery', () => {
  const f = fixture(); f.guard.request(true); f.created(); f.done([{ type: 'function_call' }]);
  assert.equal(f.sent.length, 1);
});
test('cancelled and failed responses are not mistaken for completed empty speech', () => {
  for (const status of ['cancelled', 'failed', 'incomplete']) {
    const f = fixture(); f.guard.request(true); f.created(); f.done([], status);
    assert.equal(f.sent.length, 1);
  }
});
test('caller speech, unrelated response and call closure supersede recovery', () => {
  for (const action of ['caller', 'other', 'close']) {
    const f = fixture(); f.guard.request(true); f.created();
    if (action === 'caller') f.guard.event({ type: 'input_audio_buffer.speech_started' });
    if (action === 'other') f.guard.event({ type: 'response.created', response: { id: 'other' } });
    if (action === 'close') f.guard.stop();
    f.done(); assert.equal(f.sent.length, 1);
  }
});
test('ordinary confirmation responses never trigger the post-save recovery', () => {
  const f = fixture();
  f.guard.event({ type: 'response.created', response: { id: 'ordinary' } });
  f.done([], 'completed', 'ordinary');
  assert.equal(f.sent.length, 0);
});
test('save completion uses the same intake order and preserves a pending answer or completed farewell', () => {
  const f = fixture();
  f.guard.request(true);
  const { instructions } = f.sent[0].response;

  assert.ok(instructions.includes(INTAKE_CONTINUATION_RULES));
  assert.match(instructions, /"Would you say this is routine, urgent, or an emergency\?"/);
  assert.match(instructions, /If you have already asked a question and the caller has not answered, wait/);
  assert.match(instructions, /If you have already said goodbye, remain silent unless the caller starts a new substantive turn/);
});
test('callback readback starts once after the tool response and stays in the conversation', () => {
  const f = fixture();
  const question = 'Is 4095550123 the best number to call you back?';
  f.guard.event({ type: 'response.created', response: { id: 'tool' } });
  assert.equal(f.guard.queueCallback('tool', question), true);
  assert.equal(f.guard.queueCallback('tool', question), false);
  f.done([{ type: 'function_call' }], 'completed', 'unrelated');
  assert.equal(f.sent.length, 0);
  f.done([{ type: 'function_call' }], 'completed', 'tool');
  f.done([{ type: 'function_call' }], 'completed', 'tool');
  assert.equal(f.sent.length, 1);
  const { response } = f.sent[0];
  assert.equal(response.metadata.purpose, 'callback_readback');
  assert.equal(response.tool_choice, 'none');
  assert.equal(response.conversation, undefined);
  assert.ok(response.instructions.endsWith(`"${question}"`));
  f.created('readback'); f.done([], 'completed', 'readback');
  assert.equal(f.sent.length, 2);
  assert.equal(f.sent[1].response.instructions, response.instructions);
});

test('caller interruption, replacement response, cancellation or call closure drops a queued callback', () => {
  for (const action of ['caller', 'replacement', 'cancel', 'close']) {
    const f = fixture();
    assert.equal(f.guard.queueCallback('tool', 'Is 4095550123 your callback number?'), true);
    if (action === 'caller') f.guard.event({ type: 'input_audio_buffer.speech_started' });
    if (action === 'replacement') f.guard.event({ type: 'response.created', response: { id: 'new' } });
    if (action === 'close') f.guard.stop();
    f.done([{ type: 'function_call' }], action === 'cancel' ? 'cancelled' : 'completed', 'tool');
    assert.equal(f.sent.length, 0, action);
  }
});

test('the live tool respects the latest caller turn and never marks a number confirmed', async () => {
  const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  const start = source.indexOf('if (toolCall.name === "ask_routine_callback")');
  const end = source.indexOf('// A caller may have started correcting', start);
  assert.ok(start >= 0 && end > start);
  const invoke = new Function('toolCall', 'args', 'tenant', 'callerTurns', 'origin',
    'postSaveResponse', 'event', 'send', 'ws', 'routineCallbackQuestion',
    'competitiveFeaturesForTenant', source.slice(start, end));

  for (const current of [false, true]) {
    const f = fixture();
    const sent = [];
    invoke({ name: 'ask_routine_callback', call_id: 'tool-item' },
      { callback_number: '4095550123', language: 'es' }, { features: { languages: ['en', 'es'] } },
      { canReply: () => current }, 1, f.guard, { response_id: 'tool' },
      (_ws, event) => sent.push(event), null, routineCallbackQuestion, competitiveFeaturesForTenant);
    assert.deepEqual(JSON.parse(sent[0].item.output), { question_queued: current, callback_confirmed: false });
    f.done([{ type: 'function_call' }], 'completed', 'tool');
    assert.equal(f.sent.length, current ? 1 : 0);
    if (current) assert.match(f.sent[0].response.instructions, /¿Es 409-555-0123 el mejor número/);
  }
});
test('late response.done cannot retry an older request or overwrite the newest request', () => {
  const f = fixture(); f.guard.request(true); f.created('old'); f.guard.request(false); f.created('new');
  f.done([], 'completed', 'old'); assert.equal(f.sent.length, 2);
  f.done([], 'completed', 'new'); assert.equal(f.sent.length, 3);
  assert.ok(f.sent.at(-1).response.instructions.includes('lead save failed'));
});
