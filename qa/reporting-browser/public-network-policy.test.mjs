import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedRequest, syntheticBody, signupPath, chatPath } from './tests/public-network-policy.mjs';
const origin = 'http://127.0.0.1:12345';
test('public browser fixture permits only its exact loopback assets and POST targets', () => {
  assert(allowedRequest(origin + '/dashboard/signup.html', 'GET', origin));
  assert(allowedRequest(origin + signupPath, 'POST', origin));
  assert(allowedRequest(origin + chatPath, 'POST', origin));
  for (const [url, method] of [
    ['https://bookedradar-platform.onrender.com' + signupPath, 'POST'],
    ['http://127.0.0.1:12346' + signupPath, 'POST'],
    [origin + '/api/v1/public/chat?tenant=real', 'POST'],
    [origin + chatPath + '&extra=1', 'POST'],
    [origin + signupPath, 'GET'], [origin + signupPath, 'PUT'],
    [origin + '/other', 'POST'], [origin + '/dashboard/signup.html?extra=1', 'GET']
  ]) assert.equal(allowedRequest(url, method, origin), false, url);
});
test('public browser fixture rejects non-synthetic payloads and extra fields', () => {
  const signup = { name: 'Synthetic Visitor', business: 'Synthetic QA', email: 'visitor@example.invalid', contactPreference: 'email' };
  assert(syntheticBody(signupPath, signup));
  assert(syntheticBody(signupPath, { ...signup, contactPreference: 'phone', phone: '+12025550100' }));
  for (const body of [null, [], { ...signup, email: 'real@example.com' }, { ...signup, goal: 'private data' }, { ...signup, unexpected: '' }, { ...signup, phone: '+19999999999' }])
    assert.equal(syntheticBody(signupPath, body), false);
  assert(syntheticBody(chatPath, { sessionId: '', message: 'SYNTHETIC QA hello' }));
  for (const body of [{ sessionId: 'real-session', message: 'SYNTHETIC QA hello' }, { sessionId: '', message: 'hello' }, { sessionId: '', message: 'SYNTHETIC QA hello', extra: '' }])
    assert.equal(syntheticBody(chatPath, body), false);
});
