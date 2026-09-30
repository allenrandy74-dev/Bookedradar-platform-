// Protected Twilio Function: attach only to the unpublished lab number.
const E164 = /^\+[1-9]\d{7,14}$/;
const PROJECT = /^proj_[A-Za-z0-9]{24}$/;
const SERVICE_SID = /^IS[a-f0-9]{32}$/i;
const MAP_SID = /^MP[a-f0-9]{32}$/i;

function ready(context, event, now = Date.now()) {
  const start = Date.parse(context.TEST_WINDOW_START || '');
  const end = Date.parse(context.TEST_WINDOW_END || '');
  return context.LAB_TEST_ARMED === 'true' &&
    Number.isFinite(start) && Number.isFinite(end) &&
    end > start && end - start <= 15 * 60 * 1000 &&
    now >= start && now + 120 * 1000 < end &&
    E164.test(context.PRIVATE_NUMBER || '') &&
    E164.test(context.TEST_CALLER_NUMBER || '') &&
    E164.test(context.HUMAN_FALLBACK_NUMBER || '') &&
    new Set([context.PRIVATE_NUMBER, context.TEST_CALLER_NUMBER, context.HUMAN_FALLBACK_NUMBER]).size === 3 &&
    PROJECT.test(context.PRIVATE_PROJECT_ID || '') &&
    SERVICE_SID.test(context.SYNC_SERVICE_SID || '') &&
    MAP_SID.test(context.SYNC_MAP_SID || '') &&
    /^lab-[a-z0-9-]{12,64}$/.test(context.TEST_RUN_ID || '') &&
    /^[a-z0-9-]+\.twil\.io$/i.test(context.DOMAIN_NAME || '') &&
    event.AccountSid === context.ACCOUNT_SID &&
    event.To === context.PRIVATE_NUMBER &&
    event.From === context.TEST_CALLER_NUMBER &&
    /^CA[a-f0-9]{32}$/i.test(event.CallSid || '');
}

exports.handler = async (context, event, callback) => {
  const twiml = new Twilio.twiml.VoiceResponse();
  if (!ready(context, event)) {
    twiml.reject({ reason: 'busy' });
    return callback(null, twiml);
  }
  try {
    // Sync MapItem keys are unique: only one concurrent invocation can create
    // this run's item. Never release it after an ambiguous provider outcome.
    await context.getTwilioClient().sync.v1.services(context.SYNC_SERVICE_SID)
      .syncMaps(context.SYNC_MAP_SID).syncMapItems.create({
        key: context.TEST_RUN_ID, data: { callSid: event.CallSid },
      });
  } catch (_error) {
    // Duplicate key, unavailable Sync, or missing credentials all fail closed.
    twiml.reject({ reason: 'busy' });
    return callback(null, twiml);
  }
  const dial = twiml.dial({
    action: `https://${context.DOMAIN_NAME}/private-outcome`,
    method: 'POST', answerOnBridge: true, timeout: 15, timeLimit: 60,
  });
  // The project SIP URI replaces the original To number. Preserve the validated
  // private destination using Twilio's supported called-party identity header.
  const calledParty = encodeURIComponent(`<tel:${context.PRIVATE_NUMBER}>`);
  dial.sip(`sip:${context.PRIVATE_PROJECT_ID}@sip.api.openai.com;transport=tls?P-Called-Party-ID=${calledParty}`);
  return callback(null, twiml);
};

exports._ready = ready;
