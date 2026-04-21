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
    name: 'Creator',
    price: '$19',
    cadence: '/month',
    description: 'The full Evergreen Machine system with refresh and Starden.',
    cta: 'Start Creator',
    href: STRIPE_LINKS.standard,
    features: [
      'Choose X or Bluesky',
      'Evergreen resurfacing engine',
      'Starden access',
      'Pattern Summary and Temporal Echo',
      '3-day trial',
    ],
  },
  pro: {
    name: 'Pro',
    price: '$39',
    cadence: '/month',
    description: 'The deepest Starden view with broader scope, replay, and history.',
    cta: 'Start Pro',
    href: STRIPE_LINKS.pro,
    features: [
      'X and Bluesky together',
      'Evergreen resurfacing engine',
      'Full Starden access',
      'Broader replay and history',
      'Priority access to new layers',
    ],
  },
} as const
