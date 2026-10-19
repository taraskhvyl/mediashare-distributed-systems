"""Phase 8: billing (ADR 0010). Checkout, paywall on MCP, duplicate / reordered / forged webhooks, cancel."""

import base64
import hashlib
import hmac
import json
import time

import requests
from mcp_demo import mcp_post, mcp_token

# Dev values, same defaults as .env.example (the fake provider's control API is on loopback only).
CONTROL_URL = "http://127.0.0.1:3010/control"
CONTROL_KEY = "dev-payments-control-key"
WEBHOOK_URL = "https://billing.localhost/webhooks/payments"
WEBHOOK_SECRET = "dev-payments-webhook-secret"
PAY_URL = "https://pay.localhost"
POLL_SECONDS = 15
# MCP caches a "yes" for 30 s (apps/mcp-server/src/adapters/billing-client.ts); allow for it.
REVOCATION_WAIT_SECONDS = 40


def control(method, path, body=None):
    resp = requests.request(
        method, f"{CONTROL_URL}{path}", headers={"X-Control-Key": CONTROL_KEY}, json=body, timeout=15
    )
    resp.raise_for_status()
    return resp.json()


def get_subscription(args, token):
    resp = requests.get(
        f"{args.api_base}/v1/billing/subscription",
        headers={"Authorization": f"Bearer {token}"},
        verify=False,
        timeout=15,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["subscription"]


def wait_for_status(args, token, status, timeout=POLL_SECONDS):
    """The webhook is asynchronous, so poll like the Plan page does."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        subscription = get_subscription(args, token)
        if subscription and subscription["status"] == status:
            return subscription
        time.sleep(0.5)
    raise AssertionError(f"subscription never reached {status!r}: {get_subscription(args, token)}")


def checkout(args, token):
    """What the Plan page does: ask for a checkout URL, then pay on the provider's page."""
    resp = requests.post(
        f"{args.api_base}/v1/billing/checkout",
        headers={"Authorization": f"Bearer {token}"},
        verify=False,
        timeout=15,
    )
    assert resp.status_code == 200, resp.text
    url = resp.json()["url"]
    print(f"    checkout page: {url}")
    page = requests.get(url, verify=False, timeout=15)
    assert page.status_code == 200 and "Pay" in page.text
    paid = requests.post(f"{url}/pay", allow_redirects=False, verify=False, timeout=15)
    assert paid.status_code == 303, paid.status_code
    return wait_for_status(args, token, "active")


def mcp_ping_status(args, username, password):
    token = mcp_token(args.auth_base, username, password, "openid mcp:read")
    return mcp_post(token, {"jsonrpc": "2.0", "id": 1, "method": "ping"})


def token_subject(token):
    """The Keycloak user id (`sub`) of a JWT. The provider's control API addresses users by it."""
    payload = token.split(".")[1]
    payload += "=" * (-len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(payload))["sub"]


def sign(body, timestamp):
    digest = hmac.new(WEBHOOK_SECRET.encode(), f"{timestamp}.{body}".encode(), hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={digest}"


def event_deliveries(event_id):
    events = control("GET", "/events")["events"]
    return next(e for e in events if e["id"] == event_id)["deliveries"]


def wait_for_deliveries(event_id, count, timeout=POLL_SECONDS):
    deadline = time.time() + timeout
    while time.time() < deadline:
        deliveries = event_deliveries(event_id)
        if len(deliveries) >= count:
            return deliveries
        time.sleep(0.5)
    raise AssertionError(f"{event_id}: expected {count} deliveries, got {event_deliveries(event_id)}")


def billing_subscribe_demo(args, step, demo_token, alice_token):
    """Runs BEFORE the MCP steps: MCP is a paid feature, so demo and alice must subscribe first."""
    step("B1", "MCP is a paid feature: without a subscription -> 403 subscription_required")
    assert get_subscription(args, demo_token) is None or not get_subscription(args, demo_token)["entitled"]
    resp = mcp_ping_status(args, args.username, args.password)
    print(f"    demo without a subscription: HTTP {resp.status_code}, {resp.text[:120]}")
    assert resp.status_code == 403 and "subscription_required" in resp.text

    step("B2", "demo pays on the provider's checkout page -> webhook -> subscription active -> MCP allowed")
    subscription = checkout(args, demo_token)
    print(f"    subscription: {subscription}")
    assert subscription["entitled"] is True
    resp = mcp_ping_status(args, args.username, args.password)
    print(f"    demo with a subscription: HTTP {resp.status_code}")
    assert resp.status_code == 200
    again = requests.post(
        f"{args.api_base}/v1/billing/checkout",
        headers={"Authorization": f"Bearer {demo_token}"},
        verify=False,
        timeout=15,
    )
    print(f"    checkout while subscribed: HTTP {again.status_code} (expected 409)")
    assert again.status_code == 409

    # alice is the other MCP user in the demo (the session-owner step); an existing sub is fine.
    alice_subscription = get_subscription(args, alice_token)
    if not alice_subscription or not alice_subscription["entitled"]:
        checkout(args, alice_token)


def billing_lifecycle_demo(args, step, demo_token):
    """Runs AFTER the MCP steps. Leaves demo canceled, so the next run starts at the paywall again."""
    events = control("GET", "/events")["events"]
    created = next(e for e in reversed(events) if e["type"] == "customer.subscription.created")

    step("B3", "at-least-once: the provider sends the same event again -> billing answers 'duplicate'")
    first = event_deliveries(created["id"])
    print(f"    first delivery: {first}")
    assert first and first[0]["outcome"] == "applied"
    control("POST", f"/events/{created['id']}/replay")
    deliveries = wait_for_deliveries(created["id"], len(first) + 1)
    print(f"    after replay: {deliveries}")
    assert deliveries[-1]["outcome"] == "duplicate"

    step("B4", "out of order: past_due then unpaid, delivered newest first -> still ends unpaid (no MCP)")
    user_id = token_subject(demo_token)
    control("POST", "/hold")
    control("POST", f"/users/{user_id}/subscription", {"status": "past_due"})
    control("POST", f"/users/{user_id}/subscription", {"status": "unpaid"})
    print(f"    released (newest first): {control('POST', '/release', {'reverse': True})['released']}")
    subscription = wait_for_status(args, demo_token, "unpaid")
    print(f"    billing says: {subscription['status']}, entitled={subscription['entitled']}")
    assert subscription["entitled"] is False, "a stale past_due would have kept access"

    step("B5", "past_due keeps access (the provider is still retrying); active restores it")
    control("POST", f"/users/{user_id}/subscription", {"status": "past_due"})
    subscription = wait_for_status(args, demo_token, "past_due")
    print(f"    past_due: entitled={subscription['entitled']}")
    assert subscription["entitled"] is True
    control("POST", f"/users/{user_id}/subscription", {"status": "active"})
    wait_for_status(args, demo_token, "active")

    step("B6", "the webhook endpoint is public, so it rejects forged, unsigned and stale requests")
    body = json.dumps(
        {"id": "evt_forged", "type": "customer.subscription.deleted", "data": {"object": {"id": "sub_x"}}}
    )
    headers = {"Content-Type": "application/json"}
    now = int(time.time())
    cases = {
        "no signature": {},
        "wrong signature": {"Payments-Signature": f"t={now},v1={'0' * 64}"},
        "valid signature, 10 minutes old": {"Payments-Signature": sign(body, now - 600)},
    }
    for name, extra in cases.items():
        resp = requests.post(WEBHOOK_URL, data=body, headers={**headers, **extra}, verify=False, timeout=15)
        print(f"    {name}: HTTP {resp.status_code}")
        assert resp.status_code == 400

    step("B7", "cancel at the provider -> webhook -> MCP is refused within the 30 s entitlement cache")
    control("POST", f"/users/{user_id}/subscription", {"status": "canceled"})
    wait_for_status(args, demo_token, "canceled")
    deadline = time.time() + REVOCATION_WAIT_SECONDS
    status = 200
    while status == 200 and time.time() < deadline:
        status = mcp_ping_status(args, args.username, args.password).status_code
        if status == 200:
            time.sleep(3)
    print(f"    demo after cancel: MCP HTTP {status} (expected 403)")
    assert status == 403
