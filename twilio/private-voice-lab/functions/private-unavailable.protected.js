// Number-level fallback webhook for a failed primary TwiML fetch.
// Never start a SIP or human leg from this path.
exports.handler = (_context, _event, callback) => {
  const twiml = new Twilio.twiml.VoiceResponse();
  twiml.reject({ reason: 'busy' });
  return callback(null, twiml);
};
