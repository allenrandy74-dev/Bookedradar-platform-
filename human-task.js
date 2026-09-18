export class HumanTaskAdapter {
  constructor({ onTask = null } = {}) {
    this.onTask = onTask;
  }

  async send({ action, contact, opportunity, tenant }) {
    const task = {
      title: action.template.replaceAll("_", " "),
      description: [
        `BookedRadar recovery task for ${tenant.businessName}.`,
        contact?.name ? `Contact: ${contact.name}` : "",
        contact?.phone ? `Phone: ${contact.phone}` : "",
        contact?.email ? `Email: ${contact.email}` : "",
        opportunity?.serviceType ? `Service: ${opportunity.serviceType}` : "",
        `Opportunity: ${opportunity?.id || action.opportunityId}`,
      ].filter(Boolean).join("\n"),
    };

    if (this.onTask) return this.onTask(task);
    return { provider: "internal", task };
  }
}
