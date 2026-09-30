// Protected Twilio Function: only the initial SIP <Dial> action may reach this path.
const E164 = /^\+[1-9]\d{7,14}$/;
const SERVICE_SID = /^IS[a-f0-9]{32}$/i;
const MAP_SID = /^MP[a-f0-9]{32}$/i;
const FAILED = new Set(['busy', 'failed', 'no-answer']);

function mayFallback(context, event, now = Date.now()) {
  const start = Date.parse(context.TEST_WINDOW_START || '');
  const end = Date.parse(context.TEST_WINDOW_END || '');
  return context.LAB_TEST_ARMED === 'true' &&
    Number.isFinite(start) && Number.isFinite(end) &&
    end > start && end - start <= 15 * 60 * 1000 &&
    now >= start && now < end &&
    E164.test(context.PRIVATE_NUMBER || '') &&
    E164.test(context.TEST_CALLER_NUMBER || '') &&
    E164.test(context.HUMAN_FALLBACK_NUMBER || '') &&
    new Set([context.PRIVATE_NUMBER, context.TEST_CALLER_NUMBER, context.HUMAN_FALLBACK_NUMBER]).size === 3 &&
    SERVICE_SID.test(context.SYNC_SERVICE_SID || '') &&
    MAP_SID.test(context.SYNC_MAP_SID || '') &&
    /^lab-[a-z0-9-]{12,64}$/.test(context.TEST_RUN_ID || '') &&
    event.AccountSid === context.ACCOUNT_SID &&
    event.To === context.PRIVATE_NUMBER &&
    event.From === context.TEST_CALLER_NUMBER &&
    /^CA[a-f0-9]{32}$/i.test(event.CallSid || '') &&
    FAILED.has(event.DialCallStatus) &&
    (event.DialCallStatus === 'no-answer' ||
      /^\d{3}$/.test(String(event.DialSipResponseCode || '')));
}

exports.handler = async (context, event, callback) => {
  const twiml = new Twilio.twiml.VoiceResponse();
  if (mayFallback(context, event)) {
    try {
      const map = context.getTwilioClient().sync.v1.services(context.SYNC_SERVICE_SID)
        .syncMaps(context.SYNC_MAP_SID).syncMapItems;
      const admission = await map(context.TEST_RUN_ID).fetch();
      if (admission.data?.callSid !== event.CallSid) throw new Error('call mismatch');
      await map.create({ key: `${context.TEST_RUN_ID}-fallback`,
        data: { callSid: event.CallSid } });
      twiml.dial({ callerId: context.PRIVATE_NUMBER, answerOnBridge: true,
        timeout: 20, timeLimit: 60 }).number(context.HUMAN_FALLBACK_NUMBER);
    } catch (_error) {
      // A duplicate callback or unavailable admission store cannot redial.
    }
  }
  twiml.hangup();
  return callback(null, twiml);
};

exports._mayFallback = mayFallback;
