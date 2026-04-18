export const STRIPE_LINKS = {
  standard:
    process.env.NEXT_PUBLIC_STRIPE_STANDARD_URL ||
    'https://buy.stripe.com/test_7sYeVf8M6bCU35z7kk9bO00',
  pro:
    process.env.NEXT_PUBLIC_STRIPE_PRO_URL ||
    'https://buy.stripe.com/test_00waEZe6qdL2fSlgUU9bO01',
} as const

export const PLANS = {
  standard: {
    name: 'Standard',
    price: '$19',
    cadence: '/month',
    description: 'A simple evergreen refresh engine for one platform.',
    cta: 'Start Standard',
    href: STRIPE_LINKS.standard,
    features: [
      'Choose X or Bluesky',
      'Fixed refresh settings',
      'Evergreen resurfacing engine',
      'Simple, opinionated setup',
    ],
  },
  pro: {
    name: 'Pro',
    price: '$39',
    cadence: '/month',
    description: 'The full Evergreen Machine system with Starden and flexible controls.',
    cta: 'Start Pro',
    href: STRIPE_LINKS.pro,
    features: [
      'X and Bluesky together',
      'Flexible refresh settings',
      'Evergreen resurfacing engine',
      'Starden access',
      'Broader publishing control',
    ],
  },
} as const
