import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildOperatorInstructions, operatorRulesForTenant, INTAKE_CONTINUATION_RULES, tools } from '../src/operator.js';
import { competitiveFeatureGuidance, toolsForTenant } from '../src/competitive-features.js';
import { createPostSaveResponse } from '../src/post-save-response.js';

const tenant = JSON.parse(readFileSync(new URL('../config/tenants/demo-hvac.json', import.meta.url)));
const instructions = buildOperatorInstructions({
  ...operatorRulesForTenant(tenant),
  companyName: tenant.businessName,
  companyTrade: tenant.trade,
  serviceArea: tenant.serviceArea.join(', '),
  bookingMode: tenant.policies.bookingMode,
  featureGuidance: competitiveFeatureGuidance(tenant),
  assistantDisclosure: tenant.policies.assistantDisclosure,
});

// These are offline prompt-contract checks, not generated dialogue or audio evaluations.
function assertHonestTransitions(prompt) {
  assert.ok(prompt.includes(INTAKE_CONTINUATION_RULES));
  assert.match(prompt, /Choose the next missing intake detail silently and ask for it directly/);
  assert.match(prompt, /Do not announce that you need to gather information, check what comes next, or review what else is needed/);
  assert.match(prompt, /Do not add artificial pauses or pretend to perform a lookup/);
  assert.match(prompt, /only for a real, available tool lookup you are about to perform/);
  assert.match(prompt, /report an answer only after its result/);
  assert.match(prompt, /saving with capture_lead are not lookups/);
}

test('Demo HVAC initial prompt has direct intake and truthful lookup rules', () => {
  assertHonestTransitions(instructions);
  assert.match(instructions, /Live booking is not enabled/);
  // The base tool remains advertised; the tenant configuration makes live booking unavailable.
  assert.equal(tenant.integrations.calendar.enabled, false);
  assert.equal(toolsForTenant(tools, tenant).some(tool => tool.name === 'check_availability'), true);
  assert.match(instructions, /A short pause within your speech is not a substitute for yielding the turn/);
  assert.match(instructions, /Finish saying this before invoking the tool/);
  assert.match(instructions, /If danger is already reported, give concise safety guidance before routine intake/);
});

for (const saved of [true, false]) {
  test(`post-save ${saved ? 'success' : 'failure'} and empty-response retry retain honest transition rules`, () => {
    const sent = [];
    const guard = createPostSaveResponse({ send: event => sent.push(event) });
    guard.request(saved);
    assertHonestTransitions(sent[0].response.instructions);
    assert.equal(sent[0].response.tool_choice, undefined);
    if (!saved) assert.match(sent[0].response.instructions, /Do not claim the details were saved or delivered/);
    guard.event({ type: 'response.created', response: { id: 'empty', metadata: sent[0].response.metadata } });
    guard.event({ type: 'response.done', response: { id: 'empty', status: 'completed', output: [] } });
    assert.equal(sent.length, 2);
    assertHonestTransitions(sent[1].response.instructions);
    assert.equal(sent[1].response.tool_choice, 'none');
    assert.match(sent[1].response.instructions, /Do not initiate any transfer or booking/);
  });
}

test('advisory availability retains a genuine lookup path without claiming a booking', () => {
  const prompt = buildOperatorInstructions({ companyName: 'Synthetic HVAC', bookingMode: 'live_booking' });
  assertHonestTransitions(prompt);
  assert.match(prompt, /Before check_availability, translate the caller's requested date\/time/);
  assert.match(prompt, /Do not call book_appointment or say the caller is booked/);
});
