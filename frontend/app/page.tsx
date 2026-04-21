'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { PLANS } from './lib/billing'
import { getStoredUser, me } from './lib/auth'

const pricingTiers = [
  {
    name: 'Membership',
    eyebrow: 'Full Access',
    price: PLANS.standard.price,
    cadence: PLANS.standard.cadence,
    description: 'Everything working, all the time.',
    cta: 'Start membership',
    href: PLANS.standard.href,
    features: [
      '3-day trial',
      'Automatic content resurfacing',
      'Pattern Summary',
      'Temporal Echo + Replay',
      'Why this star',
      'One continuous system',
    ],
    note: 'Keep your system running for $19.99/month.',
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
              <div className="subtle">Your best posts resurface themselves automatically</div>
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
            <div className="subtle">Your best posts resurface themselves automatically</div>
          </div>

          <div className="actions">
            <Link className="btn" href="/login">
              Log In
            </Link>
            <Link className="btn primary" href={PLANS.standard.href}>
              {PLANS.standard.cta}
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
              Your best posts are automatically resurfaced at the right time.
            </div>
            <div className="subtle" style={{ maxWidth: 520 }}>
              No dashboards. No guesswork. Just clear signals over time.
            </div>

            <div className="actions" style={{ marginTop: 10 }}>
              <Link className="btn primary" href="/signup">
                Start your 3-day trial
              </Link>
              <Link className="btn" href="#pricing">
                See Pricing
              </Link>
            </div>

            <div className="mission-note">
              Membership includes the full refresh engine and Starden.
            </div>
          </div>

          <section className="card spotlight">
            <div className="small caps">Observatory View</div>
            <div className="metric">Evergreen keeps your content active. Starden explains why.</div>
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
            <div className="small caps">One clear membership</div>
            <p>Start with a 3-day trial, then keep the full system running for one simple monthly price.</p>
          </div>
        </section>

        <section className="pricing-section" id="pricing">
          <div className="section-heading">
            <div className="tag">Pricing</div>
            <h2>Start with the full system.</h2>
            <p>
              Start with a 3-day trial, then continue with one simple membership that keeps
              Evergreen and Starden fully open.
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
              <article key={tier.name} className={`card plan-card${index === 0 ? ' recommended' : ''}`}>
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

                <Link className={`btn${index === 0 ? ' primary' : ''}`} href={tier.href}>
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
              <div className="feedItem">Start with a 3-day trial of the full Evergreen + Starden experience.</div>
              <div className="feedItem">When the trial ends, one membership keeps your view of the system open.</div>
              <div className="feedItem">Membership keeps the full engine and observatory running for $19.99/month.</div>
            </div>
          </article>
        </section>
      </div>
    </main>
  )
}
