import { actionAllowed } from "./compliance.js";

export function dispatchAllowed(input) {
  const { action } = input;
  if (['inbound_sms_reply', 'caller_text'].includes(action.template)) {
    const validRecipient = typeof action.expectedRecipient === 'string' && /^\+[1-9]\d{7,14}$/.test(action.expectedRecipient);
    const validAttestation = action.template !== 'caller_text' || (action.callerRequested === true && action.confirmedCallbackNumber === action.expectedRecipient);
    if (!validRecipient || !validAttestation) return { allowed: false, reason: 'sms_confirmation_binding_required' };
  }
  return actionAllowed(input);
}
