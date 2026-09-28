import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostSaveResponse } from '../src/post-save-response.js';
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
test('late response.done cannot retry an older request or overwrite the newest request', () => {
  const f = fixture(); f.guard.request(true); f.created('old'); f.guard.request(false); f.created('new');
  f.done([], 'completed', 'old'); assert.equal(f.sent.length, 2);
  f.done([], 'completed', 'new'); assert.equal(f.sent.length, 3);
  assert.ok(f.sent.at(-1).response.instructions.includes('lead save failed'));
});
