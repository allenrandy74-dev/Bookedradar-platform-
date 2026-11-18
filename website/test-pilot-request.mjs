import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('./src/start.js', import.meta.url), 'utf8');
const fields = new Map();
function getElementById(id) {
  if (fields.has(id)) return fields.get(id);
  const element = {
    value: id === 'contact-preference' ? 'email' : '',
    addEventListener(event, listener) { this[event] = listener; },
    reportValidity() { return true; },
    querySelector() { return this; },
    focus() {},
  };
  fields.set(id, element);
  return element;
}

const calls = [];
class SyntheticFormData {
  entries() {
    return Object.entries({ name: 'Pilot test', business: 'Test Plumbing', email: 'pilot@example.invalid', contactPreference: 'email' });
  }
}
vm.runInNewContext(source, {
  document: { getElementById }, location: { search: '?source=homepage&variant=pilot_cta' },
  navigator: { sendBeacon() {} }, FormData: SyntheticFormData, URLSearchParams, Blob,
  AbortController, setTimeout, clearTimeout,
  async fetch(url, options) {
    calls.push({ url, method: options.method, body: JSON.parse(options.body) });
    return Response.json({ ok: true });
  },
});
await getElementById('pilot-request').submit({ preventDefault() {} });
assert.equal(calls.length, 1);
assert.equal(calls[0].url, 'https://bookedradar-platform.onrender.com/api/v1/public/proof-pilot');
assert.equal(calls[0].method, 'POST');
assert.equal(calls[0].body.source, 'homepage');
assert.equal(calls[0].body.variant, 'pilot_cta');
assert.equal(getElementById('success').hidden, false);
