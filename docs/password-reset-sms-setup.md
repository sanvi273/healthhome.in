# Password reset SMS link setup

Forgot-password recovery sends a one-time link through an MSG91 **SMS Flow**. It does not call MSG91's OTP endpoints. The reset link expires after 15 minutes and can be used once.

## MSG91 configuration

Create and approve an SMS Flow template in MSG91. Map one template variable named `VAR1` to the reset URL. For Indian numbers, make sure the matching sender ID and approved DLT template are associated with the Flow.

Suggested message text:

> Reset your HealthHome password with this link: {#var#}. It expires in 15 minutes. If you did not request this, ignore this message.

Configure the template in MSG91 using its required variable format, then set:

```text
MSG91_PASSWORD_RESET_FLOW_ID=<approved SMS Flow ID>
```

The backend already uses `MSG91_AUTH_KEY`. The public API URL defaults to `https://healthhome-in-g4xh.onrender.com`; if the API uses another public host, set:

```text
PASSWORD_RESET_PUBLIC_API_URL=https://<your-api-host>
```

Do not commit these values or put MSG91 credentials in Flutter.

The forgot-password response intentionally does not say whether the phone and role matched an account. Configure the SMS Flow before enabling the feature in production; if delivery is not configured or fails, the API keeps the generic response and invalidates that undelivered link.

MSG91's Flow send endpoint accepts a template ID and recipient variables at `https://control.msg91.com/api/v5/flow`. See [MSG91 Send SMS](https://docs.msg91.com/sms/send-sms) and its [Flow ID guidance](https://msg91.com/help/template/how-to-create-flow-id-to-send-sms-via-api).
