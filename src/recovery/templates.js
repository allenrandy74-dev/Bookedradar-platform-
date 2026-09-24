function firstName(contact = {}) {
  return contact.firstName || contact.name?.split(/\s+/)?.[0] || "there";
}

export function renderTemplate(template, { contact = {}, tenant = {}, opportunity = {} } = {}) {
  const company = tenant.businessName || "our team";
  const name = firstName(contact);

  const templates = {
    phone_lead_followup:
      `Hi ${name}, this is ${company}. Thanks for speaking with us. ` +
      `If you still need help or want to add anything to your request, reply here and we'll keep it moving.`,
    missed_call_ack:
      `Hi ${name}, this is ${company}. We saw your call and don't want to leave you hanging. ` +
      `What can we help with? Reply here and we'll get the right next step moving.`,
    missed_call_followup:
      `Just checking back from ${company}. If you still need help, reply with a short description ` +
      `of the issue and your service address or city.`,
    after_hours_ack:
      `Thanks for contacting ${company}. We received your request after hours. ` +
      `If there is immediate danger, move to safety and contact emergency services or the appropriate utility. ` +
      `Otherwise, reply with what is happening and the best callback number.`,
    web_lead_ack:
      `Thanks for contacting ${company}, ${name}. We received your request and are reviewing the details now.`,
    web_lead_followup:
      `Hi ${name}, ${company} here. We wanted to make sure your service request didn't get lost. ` +
      `Is there anything else we should know before a team member follows up?`,
    web_chat_human_request:
      `Web chat request from ${name} needs human attention. Review the linked opportunity and follow up using the approved contact information.`,
    estimate_day_2:
      `Hi ${name}, checking in from ${company} about the estimate we sent. ` +
      `If you have questions about scope, timing, or next steps, reply and we'll help.`,
    estimate_day_10:
      `Hi ${name}, one last check-in from ${company} on your estimate. ` +
      `If the project is still on your radar, reply and we'll help with the next step.`,
    cancellation_reschedule:
      `Hi ${name}, we received the cancellation. If you'd like, ${company} can help find another time. ` +
      `Reply with a day or time window that works better.`,
    reactivation_1:
      `Hi ${name}, ${company} here. It's been a while since we last helped you. ` +
      `If you need service, maintenance, or have a project coming up, we're here.`,
    reactivation_2:
      `A quick follow-up from ${company}, ${name}. If there's anything around your home or business ` +
      `you've been meaning to have checked, reply and we'll point you in the right direction.`,
    membership_renewal_notice:
      `Hi ${name}, this is ${company}. Your service agreement is coming up for renewal. ` +
      `If you have questions or want help with the next step, reply here and the team will assist.`,
    appointment_reminder:
      `Hi ${name}, this is ${company} with a reminder about your upcoming service appointment. ` +
      `If you need to change the timing, reply here and we'll help get the request to the team.`,
    membership_renewal_review:
      `Review ${name}'s upcoming service-agreement renewal and confirm the approved renewal outreach.`,
    appointment_reminder_review:
      `Review the upcoming appointment reminder for ${name} and confirm any changes or special instructions.`,
    review_eligibility_review:
      `Review the completed job for ${name} before requesting a public review. Do not request a review when a complaint is open or satisfaction is uncertain.`,
    earlier_slot_waitlist_review:
      `${name} asked for an earlier appointment. Keep this request available for cancellation-backfill matching.`,
  };

  return templates[template] || `[${template}] ${company}`;
}
