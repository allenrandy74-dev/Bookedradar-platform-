import { TwilioSmsAdapter } from "./twilio-sms.js";
import { EmailWebhookAdapter } from "./email-webhook.js";
import { ResendEmailAdapter } from "./resend-email.js";
import { WixHumanTaskAdapter } from "./wix-human-task.js";
import { tenantSecret } from "../recovery/tenant-registry.js";
import { ConfirmOnlyBookingAdapter } from "./booking.js";
import { BookingWebhookAdapter } from "./booking-webhook.js";

function valueOrSecret(tenant, object, field, suffix, env) {
  return (
    object?.[field] ||
    tenantSecret(tenant, suffix, env) ||
    env[suffix] ||
    ""
  );
}

export function buildTenantAdapters(tenant, {
  env = process.env,
  timeoutMs = 8000,
  retries = 3,
} = {}) {
  const adapters = {};

  const sms = tenant?.integrations?.sms || {};
  const twilioSid = valueOrSecret(tenant, sms, "accountSid", "TWILIO_ACCOUNT_SID", env);
  const twilioToken = valueOrSecret(tenant, sms, "authToken", "TWILIO_AUTH_TOKEN", env);
  const twilioFrom = valueOrSecret(tenant, sms, "fromNumber", "TWILIO_SMS_FROM", env);
  if (sms.enabled && sms.type === "twilio" && twilioSid && twilioToken && twilioFrom) {
    adapters.sms = new TwilioSmsAdapter({
      accountSid: twilioSid,
      authToken: twilioToken,
      fromNumber: twilioFrom,
    });
  }

  const email = tenant?.integrations?.email || {};
  if (email.enabled && email.type === "webhook") {
    const emailUrl = valueOrSecret(tenant, email, "webhookUrl", "EMAIL_WEBHOOK_URL", env);
    const emailToken = valueOrSecret(tenant, email, "webhookToken", "EMAIL_WEBHOOK_TOKEN", env);
    if (emailUrl) {
      adapters.email = new EmailWebhookAdapter({
        url: emailUrl,
        token: emailToken,
      });
    }
  }

  if (email.enabled && email.type === "resend") {
    const apiKey = valueOrSecret(tenant, email, "apiKey", "RESEND_API_KEY", env);
    const from = valueOrSecret(tenant, email, "from", "RESEND_FROM_EMAIL", env);
    const replyTo = valueOrSecret(tenant, email, "replyTo", "RESEND_REPLY_TO", env);
    if (apiKey && from) {
      adapters.email = new ResendEmailAdapter({
        apiKey,
        from,
        replyTo,
      });
    }
  }

  const wix = wixCredentialsForTenant(tenant, env);
  if (wix) {
    const { apiKey: wixKey, siteId: wixSiteId } = wix;
    const human = new WixHumanTaskAdapter({
      apiKey: wixKey,
      siteId: wixSiteId,
      timeoutMs,
      retries,
    });
    adapters.human_task = human;
    adapters.human_alert = human;
  }

  return adapters;
}

export function wixCredentialsForTenant(tenant, env = process.env) {
  const crm = tenant?.integrations?.crm || {};
  if (!crm.enabled || crm.type !== "wix") return null;
  const apiKey =
    crm.apiKey ||
    tenantSecret(tenant, "WIX_API_KEY", env) ||
    "";
  const siteId =
    crm.siteId ||
    tenantSecret(tenant, "WIX_SITE_ID", env) ||
    "";
  return apiKey && siteId ? { apiKey, siteId } : null;
}


export function bookingAdapterForTenant(tenant, {
  env = process.env,
  timeoutMs = 8000,
} = {}) {
  const calendar = tenant?.integrations?.calendar || {};
  if (tenant?.policies?.bookingMode !== "live_booking") {
    return new ConfirmOnlyBookingAdapter();
  }

  const url =
    calendar.webhookUrl ||
    tenantSecret(tenant, "BOOKING_WEBHOOK_URL", env);
  const token =
    calendar.webhookToken ||
    tenantSecret(tenant, "BOOKING_WEBHOOK_TOKEN", env);

  if (calendar.enabled && calendar.type === "webhook" && url) {
    return new BookingWebhookAdapter({ url, token, timeoutMs });
  }

  return new ConfirmOnlyBookingAdapter();
}
