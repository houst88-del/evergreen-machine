# Evergreen Welcome Email Setup

Evergreen can now send a one-time welcome email after account creation.

It is intentionally safe by default:

- if Resend env vars are missing, auth still works
- welcome email sending is skipped quietly
- once an email is sent, it will not send again for that user

## Required backend env vars

Add these on the backend service:

```text
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=Evergreen Machine <notifications@evergreenmachine.ai>
```

Optional:

```text
EVERGREEN_APP_URL=https://www.evergreenmachine.ai
```

If `EVERGREEN_APP_URL` is not set, Evergreen falls back to the public app URL automatically.

## Recommended Resend setup

1. Verify your sending domain in Resend.
2. Use a sender like:
   - `notifications@evergreenmachine.ai`
   - or `hello@evergreenmachine.ai`
3. Copy the live Resend API key into the backend env vars.
4. Redeploy the backend.

## What the welcome email does

The email currently:

- welcomes the user to Evergreen Machine
- links to Mission Control
- links to Starden
- gives three first-step prompts:
  - connect a lane
  - turn on autopilot
  - open Starden

## Trigger behavior

Welcome emails are attempted when a user is created through:

- legacy email/password signup
- Clerk bootstrap for a brand-new auth user

They are not re-sent on every login.

## Quick test flow

1. Add the env vars above to the backend.
2. Redeploy the backend.
3. Create a brand-new test account.
4. Confirm the account reaches `/dashboard`.
5. Check the inbox for the welcome email.

## If it does not send

Check:

- backend env vars exist and are spelled correctly
- Resend domain is verified
- sender address matches the verified domain
- backend logs for `[evergreen][welcome-email] failed`

If the send fails, Evergreen auth still succeeds and the user can continue using the product.
