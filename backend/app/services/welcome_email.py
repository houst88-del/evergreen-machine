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

    subject = "Welcome to Evergreen Machine"
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
      <div style="background:#07110b;padding:40px 24px;font-family:Inter,system-ui,sans-serif;color:#edf6ef;">
        <div style="max-width:620px;margin:0 auto;background:#0d1912;border:1px solid rgba(156,227,169,0.18);border-radius:24px;padding:32px;">
          <div style="font-size:14px;letter-spacing:0.14em;text-transform:uppercase;color:#8aa193;margin-bottom:12px;">
            Evergreen Machine
          </div>
          <h1 style="margin:0 0 12px;font-size:34px;line-height:1.02;letter-spacing:-0.04em;">
            Welcome aboard, {handle}
          </h1>
          <p style="margin:0 0 20px;color:#cfe6d6;font-size:16px;line-height:1.6;">
            Your evergreen engine is ready. Connect a lane, start autopilot, and open Starden to see your rotation come alive.
          </p>
          <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:22px;">
            <a href="{dashboard_url}" style="display:inline-block;padding:12px 18px;border-radius:14px;background:#9ce3a9;color:#07110b;text-decoration:none;font-weight:700;">
              Open Mission Control
            </a>
            <a href="{starden_url}" style="display:inline-block;padding:12px 18px;border-radius:14px;border:1px solid rgba(156,227,169,0.22);color:#edf6ef;text-decoration:none;font-weight:600;">
              Open Starden
            </a>
          </div>
          <div style="border-top:1px solid rgba(156,227,169,0.12);padding-top:16px;color:#a7c0b2;font-size:14px;line-height:1.6;">
            <div>Suggested first steps:</div>
            <div>1. Connect X or Bluesky</div>
            <div>2. Turn on Autopilot</div>
            <div>3. Watch Starden map the next pulse</div>
          </div>
          <div style="margin-top:18px;color:#8aa193;font-size:13px;">
            A portion of revenue supports climate-focused initiatives.
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
