'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { PLANS } from './lib/billing'
import { getStoredUser, me } from './lib/auth'

const pricingTiers = [
  {
    name: 'Explorer',
    eyebrow: 'Free',
    price: '$0',
    cadence: '/month',
    description: 'Get a feel for your system.',
    cta: 'Start Free',
    href: '/signup',
    features: [
      '1 account',
      'Full Starden view',
      'Pattern Summary',
      'Temporal Echo',
      'Recent activity window',
    ],
    note: 'Start understanding your content immediately.',
  },
  {
    name: 'Creator',
    eyebrow: 'Most Popular',
    price: PLANS.standard.price,
    cadence: PLANS.standard.cadence,
    description: 'See the full picture.',
    cta: 'Start Creator',
    href: PLANS.standard.href,
    features: [
      'Multiple accounts',
      'Full Pattern Summary',
      'Deeper Temporal Echo',
      'Extended history window',
      'Early replay memory',
    ],
    note: 'Understand what works across your content system.',
  },
  {
    name: 'Pro',
    eyebrow: 'Premium',
    price: PLANS.pro.price,
    cadence: PLANS.pro.cadence,
    description: 'For creators who rely on timing and patterns.',
    cta: 'Start Pro',
    href: PLANS.pro.href,
    features: [
      'Full history window',
      'Full replay memory',
      'Advanced pattern insight',
      'Priority access to new layers',
      'Cross-platform observatory',
    ],
    note: 'Track patterns over time and anticipate what comes next.',
  },
] as const

export default function HomePage() {
  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
  const router = useRouter()
  const [finalizingSession, setFinalizingSession] = useState(false)

  useEffect(() => {
    const storedUser = getStoredUser()

    if (storedUser) {
      setFinalizingSession(true)
      router.replace('/dashboard')
      return
    }

    if (!clerkEnabled) {
      return
    }

    let mounted = true

    async function finalizeClerkSession() {
      try {
        const session = await me()
        if (!mounted) return

        if (session?.user) {
          setFinalizingSession(true)
          router.replace('/dashboard')
          return
        }
      } finally {
        if (mounted) {
          setFinalizingSession(false)
        }
      }
    }

    void finalizeClerkSession()

    return () => {
      mounted = false
    }
  }, [clerkEnabled, router])

  if (finalizingSession) {
    return (
      <main className="page marketing-page">
        <div className="shell">
          <header className="header">
            <div>
              <div className="wordmark">Evergreen Machine</div>
              <div className="subtle">Refresh forever. Reach further.</div>
            </div>
          </header>

          <section className="card" style={{ maxWidth: 680 }}>
            Finalizing your account...
          </section>
        </div>
      </main>
    )
  }

  return (
    <main className="page marketing-page">
      <div className="shell">
        <header className="header">
          <div>
            <div className="wordmark">Evergreen Machine</div>
            <div className="subtle">Refresh forever. Reach further.</div>
          </div>

          <div className="actions">
            <Link className="btn" href="/login">
              Log In
            </Link>
            <Link className="btn primary" href={PLANS.pro.href}>
              {PLANS.pro.cta}
            </Link>
          </div>
        </header>

        <section className="hero hero-grid">
          <div>
            <div className="tag">Starden</div>
            <h1>Understand how your content actually behaves</h1>
            <p>
              Starden maps your posts as a living system, so you can see what&apos;s working,
              when it moves, and why it gets selected.
            </p>
            <div className="subtle" style={{ maxWidth: 520 }}>
              No dashboards. No guesswork. Just clear signals over time.
            </div>

            <div className="actions" style={{ marginTop: 10 }}>
              <Link className="btn primary" href="/signup">
                Open Starden
              </Link>
              <Link className="btn" href="#pricing">
                See Pricing
              </Link>
            </div>

            <div className="mission-note">
              No credit card required.
            </div>
          </div>

          <section className="card spotlight">
            <div className="small caps">Observatory View</div>
            <div className="metric">Evergreen Machine executes. Starden explains.</div>
            <div className="feed">
              <div className="feedItem">
                <strong>See patterns, not just posts</strong>
                <div className="small">Recognize which kinds of content are rising, holding steady, or fading.</div>
              </div>
              <div className="feedItem">
                <strong>Track momentum and timing</strong>
                <div className="small">
                  Watch recent pulses, quiet signals, and what&apos;s likely next without leaving the field.
                </div>
              </div>
              <div className="feedItem">
                <strong>Understand why content gets reused</strong>
                <div className="small">Starden turns selection behavior into something you can actually read.</div>
              </div>
            </div>
          </section>
        </section>

        <section className="marketing-band">
          <div className="mini-card">
            <div className="small caps">Pattern-first</div>
            <p>See what type of content is working instead of staring at a flat list of posts.</p>
          </div>
          <div className="mini-card">
            <div className="small caps">Time-aware</div>
            <p>Follow momentum, next-bloom timing, and recent pulses in one calm surface.</p>
          </div>
          <div className="mini-card">
            <div className="small caps">Cross-platform ready</div>
            <p>Start with one lane, then go deeper as you want more time, scope, and clarity.</p>
          </div>
        </section>

        <section className="pricing-section" id="pricing">
          <div className="section-heading">
            <div className="tag">Pricing</div>
            <h2>Start free. Go deeper when you&apos;re ready.</h2>
            <p>
              Starden stays valuable at the core. Paid plans unlock more time, more context, and
              a wider view across your content system.
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 18,
            }}
          >
            {pricingTiers.map((tier, index) => (
              <article
                key={tier.name}
                className={`card plan-card${index === 1 ? ' recommended' : ''}`}
              >
                <div className="plan-topline">{tier.name}</div>
                <div className="small caps" style={{ marginTop: 4 }}>{tier.eyebrow}</div>
                <div className="plan-price">
                  {tier.price}
                  <span>{tier.cadence}</span>
                </div>
                <p className="plan-copy">{tier.description}</p>
                <div className="small">{tier.note}</div>

                <ul className="feature-list">
                  {tier.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>

                <Link className={`btn${index > 0 ? ' primary' : ''}`} href={tier.href}>
                  {tier.cta}
                </Link>
              </article>
            ))}
          </div>
        </section>

        <section className="grid two info-grid">
          <article className="card">
            <h2>This isn&apos;t analytics. It&apos;s understanding.</h2>
            <div className="feed">
              <div className="feedItem">
                Most tools show you what happened. Starden shows you how your content behaves.
              </div>
              <div className="feedItem">
                See which patterns are rising, what&apos;s likely to be reused next, and what&apos;s fading out.
              </div>
              <div className="feedItem">
                Stop guessing and start recognizing what actually works.
              </div>
            </div>
          </article>

          <article className="card">
            <h2>Go deeper when you&apos;re ready</h2>
            <div className="feed">
              <div className="feedItem">Start free with the core galaxy experience.</div>
              <div className="feedItem">Upgrade when you want more time, more context, and more clarity.</div>
              <div className="feedItem">No locked core experience. Just deeper insight.</div>
            </div>
          </article>
        </section>

        <section className="card mission-card">
          <div className="tag">Onboarding</div>
          <h2>Being shown the sky, not reading a manual.</h2>
          <p>
            First load should surface the field, a live signal, and one obvious why-this-star
            moment in under a minute. The product should create one aha, then get out of the way.
          </p>
        </section>
      </div>
    </main>
  )
}
