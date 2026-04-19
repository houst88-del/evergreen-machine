from __future__ import annotations

import os
from datetime import datetime

import httpx

from app.models.models import User


RESEND_API_URL = "https://api.resend.com/emails"


def app_origin() -> str:
    return (
        os.getenv("EVERGREEN_APP_URL", "").strip()
        or os.getenv("EVERGREEN_DASHBOARD_URL", "").strip()
        or "https://www.evergreenmachine.ai"
    ).rstrip("/")


def welcome_email_configured() -> bool:
    return bool(os.getenv("RESEND_API_KEY", "").strip() and os.getenv("RESEND_FROM_EMAIL", "").strip())


def build_welcome_email(user: User) -> tuple[str, str, str]:
    handle = str(user.handle or "@creator")
    dashboard_url = f"{app_origin()}/dashboard"
    starden_url = f"{app_origin()}/galaxy"

    subject = "✦🌿 Welcome to Evergreen Machine"
    text = (
        f"Welcome to Evergreen Machine, {handle}.\n\n"
        "Your account is ready.\n\n"
        f"Open Mission Control: {dashboard_url}\n"
        f"Open Starden: {starden_url}\n\n"
        "Suggested first steps:\n"
        "1. Connect X or Bluesky\n"
        "2. Turn on Autopilot\n"
        "3. Open Starden to watch the engine work\n\n"
        "A portion of revenue supports climate-focused initiatives.\n"
    )
    html = f"""
      <div style="margin:0;padding:0;background:#07110b;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#edf6ef;">
        <div style="max-width:720px;margin:0 auto;padding:18px 20px 36px;">
          <div style="margin-bottom:12px;padding:14px 18px;border-radius:20px;border:1px solid rgba(156,227,169,0.14);background:#0a1510;">
            <div style="font-size:13px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#8aa193;">
              Evergreen Machine
            </div>
          </div>

          <div style="position:relative;overflow:hidden;border-radius:30px;border:1px solid rgba(156,227,169,0.18);background:linear-gradient(180deg,#102017 0%,#0b1711 58%,#09140f 100%);">
            <div style="height:96px;background:
              radial-gradient(circle at 14% 28%, rgba(156,227,169,0.18) 0, rgba(156,227,169,0.18) 2px, transparent 3px),
              radial-gradient(circle at 24% 42%, rgba(147,197,253,0.95) 0, rgba(147,197,253,0.95) 2px, transparent 3px),
              radial-gradient(circle at 34% 22%, rgba(254,240,138,0.9) 0, rgba(254,240,138,0.9) 2px, transparent 3px),
              radial-gradient(circle at 58% 36%, rgba(196,181,253,0.75) 0, rgba(196,181,253,0.75) 1px, transparent 2px),
              radial-gradient(circle at 72% 26%, rgba(156,227,169,0.85) 0, rgba(156,227,169,0.85) 1.5px, transparent 2.5px),
              radial-gradient(circle at 84% 48%, rgba(191,219,254,0.9) 0, rgba(191,219,254,0.9) 2px, transparent 3px),
              linear-gradient(180deg, rgba(11,23,17,0.22) 0%, rgba(11,23,17,0.02) 100%);
            ">
              <div style="width:180px;height:180px;border-radius:999px;background:radial-gradient(circle, rgba(250,204,21,0.22) 0%, rgba(250,204,21,0.06) 38%, rgba(250,204,21,0) 72%);margin:10px auto 0;"></div>
            </div>

            <div style="padding:0 44px 36px;margin-top:-10px;">
              <div style="display:inline-block;padding:9px 14px;border-radius:999px;background:rgba(11,23,17,0.88);border:1px solid rgba(156,227,169,0.14);font-size:13px;letter-spacing:0.16em;text-transform:uppercase;color:#9eb5a7;">
                ✦🌿 Starden-ready
              </div>

              <h1 style="margin:22px 0 12px;font-size:42px;line-height:1.02;letter-spacing:-0.05em;color:#f3fbf5;">
                Welcome aboard, {handle}
              </h1>

              <p style="margin:0 0 24px;max-width:540px;color:#d3e7d8;font-size:18px;line-height:1.65;">
                Your evergreen engine is ready. Connect a lane, start autopilot, and open Starden to watch your rotation come alive.
              </p>

              <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:26px;">
                <a href="{dashboard_url}" style="display:inline-block;padding:14px 20px;border-radius:16px;background:#9ce3a9;color:#07110b;text-decoration:none;font-size:16px;font-weight:700;">
                  Open Mission Control
                </a>
                <a href="{starden_url}" style="display:inline-block;padding:14px 20px;border-radius:16px;border:1px solid rgba(156,227,169,0.18);background:rgba(255,255,255,0.02);color:#edf6ef;text-decoration:none;font-size:16px;font-weight:600;">
                  Open Starden
                </a>
              </div>

              <div style="padding:18px 20px;border-radius:22px;background:rgba(255,255,255,0.02);border:1px solid rgba(156,227,169,0.10);">
                <div style="margin-bottom:8px;font-size:13px;letter-spacing:0.14em;text-transform:uppercase;color:#8aa193;">
                  Suggested first steps
                </div>
                <div style="color:#d7e9db;font-size:15px;line-height:1.8;">
                  1. Connect X or Bluesky<br />
                  2. Turn on Autopilot<br />
                  3. Watch Starden map the next pulse
                </div>
              </div>

              <div style="margin-top:18px;color:#8aa193;font-size:13px;line-height:1.6;">
                A portion of revenue supports climate-focused initiatives.
              </div>
            </div>
          </div>
        </div>
      </div>
    """.strip()
    return subject, text, html


def maybe_send_welcome_email(db, user: User) -> bool:
    if user.welcome_email_sent_at or not welcome_email_configured():
        return False

    subject, text, html = build_welcome_email(user)
    payload = {
        "from": os.getenv("RESEND_FROM_EMAIL", "").strip(),
        "to": [str(user.email)],
        "subject": subject,
        "text": text,
        "html": html,
    }

    with httpx.Client(timeout=10) as client:
        response = client.post(
            RESEND_API_URL,
            json=payload,
            headers={
                "Authorization": f"Bearer {os.getenv('RESEND_API_KEY', '').strip()}",
                "Content-Type": "application/json",
            },
        )
        if response.is_error:
            raise RuntimeError(
                f"Resend send failed ({response.status_code}): {response.text.strip() or 'empty response'}"
            )

    user.welcome_email_sent_at = datetime.utcnow()
    db.add(user)
    db.commit()
    db.refresh(user)
    return True
