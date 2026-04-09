"""
Uber Driver Portal API capture script for mitmproxy.
Captures all Uber-related API calls with full request/response details.

Usage:
  mitmdump -s uber_api_capture.py -p 8888 --set block_global=false

Then configure Chrome:
  /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
    --proxy-server="http://localhost:8888" \
    --user-data-dir="$HOME/.chrome-uber-capture" \
    --ignore-certificate-errors \
    "https://drivers.uber.com"
"""

import json
import time
import os
from datetime import datetime
from mitmproxy import http, ctx

UBER_DOMAINS = [
    "uber.com",
    "auth.uber.com",
    "drivers.uber.com",
    "login.uber.com",
    "accounts.uber.com",
    "cn-geo1.uber.com",
    "supply.uber.com",
]

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "uber_api_logs")
os.makedirs(OUTPUT_DIR, exist_ok=True)

captured = []
call_counter = 0


def is_uber_request(flow: http.HTTPFlow) -> bool:
    host = flow.request.pretty_host
    return any(domain in host for domain in UBER_DOMAINS)


def safe_decode(content: bytes | None, limit: int = 50000) -> str:
    if not content:
        return ""
    try:
        text = content.decode("utf-8", errors="replace")
        if len(text) > limit:
            return text[:limit] + f"\n... [truncated, total {len(text)} chars]"
        return text
    except Exception:
        return f"<binary {len(content)} bytes>"


def parse_body(content: bytes | None) -> dict | str:
    if not content:
        return ""
    try:
        return json.loads(content)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return safe_decode(content)


def response(flow: http.HTTPFlow):
    if not is_uber_request(flow):
        return

    global call_counter
    call_counter += 1

    req = flow.request
    resp = flow.response

    entry = {
        "seq": call_counter,
        "timestamp": datetime.now().isoformat(),
        "method": req.method,
        "url": req.pretty_url,
        "host": req.pretty_host,
        "path": req.path,
        "status_code": resp.status_code if resp else None,
        "request_headers": dict(req.headers),
        "request_cookies": dict(req.cookies),
        "request_body": parse_body(req.get_content()),
        "response_headers": dict(resp.headers) if resp else {},
        "response_body": parse_body(resp.get_content()) if resp else "",
        "content_type": resp.headers.get("content-type", "") if resp else "",
        "duration_ms": round((flow.response.timestamp_end - flow.request.timestamp_start) * 1000, 1)
            if resp and hasattr(resp, "timestamp_end") and resp.timestamp_end else None,
    }

    captured.append(entry)

    is_auth = any(kw in req.path.lower() for kw in [
        "auth", "login", "otp", "verify", "token", "session",
        "challenge", "password", "sms", "whatsapp", "email",
        "mfa", "2fa", "totp", "code", "consent", "account",
    ])

    tag = " [AUTH/OTP]" if is_auth else ""
    body_preview = ""
    if isinstance(entry["request_body"], dict):
        body_preview = f" body_keys={list(entry['request_body'].keys())[:8]}"
    elif isinstance(entry["request_body"], str) and entry["request_body"]:
        body_preview = f" body={entry['request_body'][:80]}"

    resp_preview = ""
    if isinstance(entry["response_body"], dict):
        resp_preview = f" resp_keys={list(entry['response_body'].keys())[:8]}"

    ctx.log.info(
        f"#{call_counter}{tag} {req.method} {resp.status_code} "
        f"{req.pretty_host}{req.path[:80]}{body_preview}{resp_preview}"
    )

    outfile = os.path.join(OUTPUT_DIR, f"{call_counter:04d}_{req.method}_{req.pretty_host}_{req.path.replace('/', '_')[:60]}.json")
    try:
        with open(outfile, "w") as f:
            json.dump(entry, f, indent=2, default=str)
    except Exception:
        pass


def done():
    summary_file = os.path.join(OUTPUT_DIR, "_FULL_CAPTURE_SUMMARY.json")
    with open(summary_file, "w") as f:
        json.dump({
            "total_calls": len(captured),
            "capture_end": datetime.now().isoformat(),
            "calls": captured,
        }, f, indent=2, default=str)
    ctx.log.info(f"Saved {len(captured)} API calls to {summary_file}")

    auth_calls = [c for c in captured if any(
        kw in c["path"].lower()
        for kw in ["auth", "login", "otp", "verify", "token", "challenge", "sms", "whatsapp", "mfa", "code"]
    )]
    if auth_calls:
        auth_file = os.path.join(OUTPUT_DIR, "_AUTH_OTP_CALLS.json")
        with open(auth_file, "w") as f:
            json.dump(auth_calls, f, indent=2, default=str)
        ctx.log.info(f"Saved {len(auth_calls)} auth/OTP-related calls to {auth_file}")
