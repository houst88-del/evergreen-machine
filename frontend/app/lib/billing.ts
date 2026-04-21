export const STRIPE_LINKS = {
  standard:
    process.env.NEXT_PUBLIC_STRIPE_STANDARD_URL ||
    'https://buy.stripe.com/9B6eV5fEo1ws27T9OQ1B601',
  pro:
    process.env.NEXT_PUBLIC_STRIPE_PRO_URL ||
    'https://buy.stripe.com/cNibITcscb72aEp0eg1B600',
} as const

export const PLANS = {
  standard: {
    name: 'Membership',
    price: '$19.99',
    cadence: '/month',
    description: 'The full Evergreen Machine system with refresh and Starden.',
    cta: 'Start membership',
    href: STRIPE_LINKS.standard,
    features: [
      '3-day trial',
      'Full Evergreen resurfacing engine',
      'Full Starden observatory',
      'Choose X or Bluesky',
      'Pattern Summary, Temporal Echo, and replay memory',
    ],
  },
  pro: {
    name: 'Membership',
    price: '$19.99',
    cadence: '/month',
    description: 'The full Evergreen Machine system with refresh and Starden.',
    cta: 'Start membership',
    href: STRIPE_LINKS.standard,
    features: [
      '3-day trial',
      'Full Evergreen resurfacing engine',
      'Full Starden observatory',
      'Evergreen resurfacing engine',
      'Choose X or Bluesky',
      'Pattern Summary, Temporal Echo, and replay memory',
    ],
  },
} as const
