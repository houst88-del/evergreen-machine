Stripe webhook setup for Evergreen Machine:

1. In Stripe, go to Developers -> Webhooks.
2. Add an endpoint:
   `https://backend-fixed-production.up.railway.app/api/stripe/webhook`
3. Subscribe to these events:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
4. Copy the signing secret from Stripe.
5. In Railway `backend (fixed)` variables, add:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
6. Redeploy `backend (fixed)`.

How activation works:

- Evergreen matches Stripe payments by customer email.
- When Stripe reports a successful checkout or active subscription, Evergreen marks that email as `active`.
- When Stripe reports a deleted/cancelled subscription, Evergreen marks that email as `inactive`.
- Trial users automatically stop Autopilot when the trial expires unless Stripe has activated the account.

Important:

- The email used at Stripe checkout should match the Evergreen account email.
- If you use both Standard and Pro payment links, Stripe event data will still activate the account even if the exact plan tier is not yet surfaced in the app UI.
