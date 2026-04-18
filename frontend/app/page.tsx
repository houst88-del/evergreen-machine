import Link from 'next/link'
import { PLANS } from './lib/billing'

const comparisonRows = [
  { label: 'Platforms', standard: 'Choose X or Bluesky', pro: 'X + Bluesky' },
  { label: 'Refresh engine', standard: 'Yes', pro: 'Yes' },
  { label: 'Refresh settings', standard: 'Fixed', pro: 'Flexible' },
  { label: 'Starden', standard: 'No', pro: 'Yes' },
  { label: 'User control', standard: 'Simple defaults', pro: 'More control' },
]

export default function HomePage() {
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
            <div className="tag">Evergreen publishing engine</div>
            <h1>Build once. Refresh forever.</h1>
            <p>
              Evergreen Machine keeps your best content moving. Start with a focused refresh
              engine, or unlock the full system with Starden and flexible controls.
            </p>

            <div className="actions" style={{ marginTop: 10 }}>
              <Link className="btn primary" href={PLANS.pro.href}>
                Start Pro
              </Link>
              <Link className="btn" href={PLANS.standard.href}>
                Try Standard
              </Link>
            </div>

            <div className="mission-note">
              A portion of revenue supports climate-focused initiatives.
            </div>
          </div>

          <section className="card spotlight">
            <div className="small caps">Why it matters</div>
            <div className="metric">Turn your backlog into a living growth system.</div>
            <div className="feed">
              <div className="feedItem">
                <strong>Standard</strong>
                <div className="small">A simple refresh engine for one platform with clear defaults.</div>
              </div>
              <div className="feedItem">
                <strong>Pro</strong>
                <div className="small">
                  Flexible refresh control, multi-platform publishing, and Starden included.
                </div>
              </div>
              <div className="feedItem">
                <strong>Upgrade path</strong>
                <div className="small">Start focused, then expand when you want more reach and control.</div>
              </div>
            </div>
          </section>
        </section>

        <section className="marketing-band">
          <div className="mini-card">
            <div className="small caps">Clarify the offer</div>
            <p>One product, two clear paths: refresh engine or full system.</p>
          </div>
          <div className="mini-card">
            <div className="small caps">Keep it evergreen</div>
            <p>Resurface the posts worth keeping alive instead of rebuilding every week.</p>
          </div>
          <div className="mini-card">
            <div className="small caps">Scale intentionally</div>
            <p>Start simple, then add Starden and broader publishing control when you need it.</p>
          </div>
        </section>

        <section className="pricing-section" id="pricing">
          <div className="section-heading">
            <div className="tag">Pricing</div>
            <h2>Simple plans for evergreen growth</h2>
            <p>
              Start with a focused refresh engine or unlock the full Evergreen Machine system
              for more control, more reach, and Starden access.
            </p>
          </div>

          <div className="grid two pricing-grid">
            <article className="card plan-card">
              <div className="plan-topline">{PLANS.standard.name}</div>
              <div className="plan-price">
                {PLANS.standard.price}
                <span>{PLANS.standard.cadence}</span>
              </div>
              <p className="plan-copy">{PLANS.standard.description}</p>
              <div className="small">Great for creators who want a set-it-and-run-it system.</div>

              <ul className="feature-list">
                {PLANS.standard.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>

              <div className="small muted-list">No Starden. No flexible controls. One platform only.</div>

              <Link className="btn" href={PLANS.standard.href}>
                {PLANS.standard.cta}
              </Link>
            </article>

            <article className="card plan-card recommended">
              <div className="plan-badge">Most Popular</div>
              <div className="plan-topline">{PLANS.pro.name}</div>
              <div className="plan-price">
                {PLANS.pro.price}
                <span>{PLANS.pro.cadence}</span>
              </div>
              <p className="plan-copy">{PLANS.pro.description}</p>
              <div className="small">
                Best for users who want the full Evergreen Machine system.
              </div>

              <ul className="feature-list">
                {PLANS.pro.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>

              <Link className="btn primary" href={PLANS.pro.href}>
                {PLANS.pro.cta}
              </Link>
            </article>
          </div>
        </section>

        <section className="card comparison-card">
          <div className="section-heading compact">
            <div className="tag">Compare</div>
            <h2>Standard is the refresh engine. Pro is the full system.</h2>
          </div>

          <div className="comparison-table">
            {comparisonRows.map((row) => (
              <div className="comparison-row" key={row.label}>
                <div className="comparison-label">{row.label}</div>
                <div>{row.standard}</div>
                <div>{row.pro}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="grid two info-grid">
          <article className="card">
            <h2>Which plan should I choose?</h2>
            <div className="feed">
              <div className="feedItem">
                Choose <strong>Standard</strong> if you want the simplest way to keep content
                moving on one platform.
              </div>
              <div className="feedItem">
                Choose <strong>Pro</strong> if you want flexible refresh settings, both
                platforms, and Starden.
              </div>
              <div className="feedItem">
                You can start with Standard and upgrade later.
              </div>
            </div>
          </article>

          <article className="card">
            <h2>What happens after checkout?</h2>
            <div className="feed">
              <div className="feedItem">Standard activates your refresh engine and lets you choose one platform.</div>
              <div className="feedItem">Pro activates the full Evergreen Machine system with Starden access.</div>
              <div className="feedItem">Both plans can flow into account creation and onboarding.</div>
            </div>
          </article>
        </section>

        <section className="card mission-card">
          <div className="tag">Mission</div>
          <h2>Built to be evergreen in more ways than one.</h2>
          <p>
            A portion of Evergreen Machine revenue supports climate-focused initiatives,
            so growth can compound in a direction that matters.
          </p>
        </section>
      </div>
    </main>
  )
}
