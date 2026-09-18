# Multi-Tenant Setup

Create one JSON file per customer in `config/tenants/`.

Each tenant must have a unique `tenantId`. If inbound AI phone service is enabled, each inbound phone number must belong to exactly one tenant.

Use `secretsPrefix` to keep credentials out of JSON. Example:

```json
{
  "tenantId": "smith-hvac",
  "secretsPrefix": "SMITH_HVAC",
  "integrations": {
    "phone": {
      "enabled": true,
      "type": "sip",
      "inboundNumbers": ["+14095551234"]
    },
    "sms": { "enabled": true, "type": "twilio" },
    "crm": { "enabled": true, "type": "wix" },
    "email": { "enabled": true, "type": "webhook" }
  }
}
```

Then configure secrets in the deployment environment:

- `SMITH_HVAC_TWILIO_ACCOUNT_SID`
- `SMITH_HVAC_TWILIO_AUTH_TOKEN`
- `SMITH_HVAC_TWILIO_SMS_FROM`
- `SMITH_HVAC_WIX_API_KEY`
- `SMITH_HVAC_WIX_SITE_ID`
- `SMITH_HVAC_EMAIL_WEBHOOK_URL`
- `SMITH_HVAC_EMAIL_WEBHOOK_TOKEN`

The API requires the tenant selector for multi-tenant deployments:

`x-bookedradar-tenant: smith-hvac`

Voice calls are routed by the actual number dialed, not by an HTTP tenant header.

Live-booking tenants may additionally use `<PREFIX>_BOOKING_WEBHOOK_URL` and `<PREFIX>_BOOKING_WEBHOOK_TOKEN`. Tenants without a verified booking adapter stay in `confirm_only`.
