"""mitmdump script to capture Uber earnings API calls — focused on bonus/quest detail endpoints."""
import json
import os
from datetime import datetime
from mitmproxy import http

OUT_DIR = os.path.expanduser("~/Projects/driversreward/bonus_api_logs")
os.makedirs(OUT_DIR, exist_ok=True)

seq = 0

def response(flow: http.HTTPFlow):
    global seq
    host = flow.request.pretty_host
    path = flow.request.path

    if "drivers.uber.com" not in host:
        return
    if "/earnings/api/" not in path:
        return
    # Skip the ones we already know
    if "getWebActivityFeed" in path:
        return

    seq += 1
    ct = flow.response.headers.get("content-type", "")

    body = None
    if "json" in ct:
        try:
            body = json.loads(flow.response.get_text())
        except Exception:
            body = flow.response.get_text()[:5000]

    req_body = None
    req_ct = flow.request.headers.get("content-type", "")
    if "json" in req_ct:
        try:
            req_body = json.loads(flow.request.get_text())
        except Exception:
            req_body = flow.request.get_text()[:2000]

    entry = {
        "seq": seq,
        "timestamp": datetime.now().isoformat(),
        "method": flow.request.method,
        "url": flow.request.pretty_url,
        "path": path,
        "status_code": flow.response.status_code,
        "request_body": req_body,
        "response_body": body,
        "content_type": ct,
    }

    fname = f"{seq:04d}_{flow.request.method}_{path.replace('/', '_')[:80]}.json"
    fpath = os.path.join(OUT_DIR, fname)
    with open(fpath, "w") as f:
        json.dump(entry, f, indent=2, ensure_ascii=False)

    print(f"[{seq}] {flow.request.method} {path} -> {flow.response.status_code}")
