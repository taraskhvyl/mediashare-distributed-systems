"""Phase 7b: the MCP server. Auth boundaries (ADR 0009), tools, scope step-up, session ownership."""

import json
import time

import requests

MCP_URL = "https://mcp.localhost/mcp"
MCP_METADATA_URL = "https://mcp.localhost/.well-known/oauth-protected-resource/mcp"
JSON_AND_SSE = "application/json, text/event-stream"
RATE_LIMIT_RETRIES = 5
RATE_LIMIT_WAIT_SECONDS = 4
EXPECTED_TOOLS = {"whoami", "list_feed", "list_my_files", "get_file", "like_file", "follow_user"}


def mcp_token(auth_base, username, password, scope):
    """A token for the MCP server (aud = its URL), from the media-mcp client."""
    resp = requests.post(
        f"{auth_base}/realms/media/protocol/openid-connect/token",
        data={
            "grant_type": "password",
            "client_id": "media-mcp",
            "username": username,
            "password": password,
            "scope": scope,
        },
        verify=False,
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def mcp_post(token, body, session_id=None, wait_out_rate_limit=True):
    """POST one JSON-RPC message. Envoy's per-user MCP limit answers 429 + Retry-After: wait it out,
    like a well-behaved client (the burst step turns this off to see the 429)."""
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": JSON_AND_SSE}
    if session_id:
        headers["Mcp-Session-Id"] = session_id
    for _ in range(RATE_LIMIT_RETRIES):
        resp = requests.post(MCP_URL, headers=headers, json=body, verify=False, timeout=30)
        if resp.status_code != 429 or not wait_out_rate_limit:
            return resp
        time.sleep(int(resp.headers.get("Retry-After", 1)))
    return resp


def rpc_result(resp):
    """The JSON-RPC message of a reply (the server answers as one SSE `data:` line)."""
    data_line = next(line for line in resp.text.splitlines() if line.startswith("data: "))
    return json.loads(data_line[len("data: ") :])


def open_session(token):
    resp = mcp_post(
        token,
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-11-25",
                "capabilities": {},
                "clientInfo": {"name": "mediashare-demo", "version": "1"},
            },
        },
    )
    assert resp.status_code == 200, f"initialize failed: HTTP {resp.status_code} {resp.text[:200]}"
    session_id = resp.headers["Mcp-Session-Id"]
    mcp_post(token, {"jsonrpc": "2.0", "method": "notifications/initialized"}, session_id)
    return session_id


def call_tool(token, session_id, name, arguments=None, wait_out_rate_limit=True):
    resp = mcp_post(
        token,
        {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments or {}},
        },
        session_id,
        wait_out_rate_limit,
    )
    return resp


def call_write_tool(token, session_id, name, arguments):
    """Writes share the api's per-user write bucket, which earlier demo steps drain: wait it out."""
    for _ in range(RATE_LIMIT_RETRIES):
        resp = call_tool(token, session_id, name, arguments)
        is_error, payload = tool_text(resp)
        if not (is_error and "Too many" in payload):
            return is_error, payload
        print(f"    api rate limit reached through MCP too; waiting {RATE_LIMIT_WAIT_SECONDS}s")
        time.sleep(RATE_LIMIT_WAIT_SECONDS)
    raise AssertionError(f"{name} still rate-limited after {RATE_LIMIT_RETRIES} tries")


def tool_text(resp):
    result = rpc_result(resp)["result"]
    return result.get("isError", False), json.loads(result["content"][0]["text"]) if not result.get(
        "isError"
    ) else result["content"][0]["text"]


def mcp_demo(args, step, api_token, published_file_id):
    """published_file_id: a file the demo user may read and like (alice's, still public)."""
    read_token = mcp_token(args.auth_base, args.username, args.password, "openid mcp:read")

    step(
        "18b",
        "MCP server: no token -> 401 that points at the login; wrong-audience tokens are refused both ways",
    )
    resp = requests.post(MCP_URL, json={}, verify=False, timeout=15)
    challenge = resp.headers.get("WWW-Authenticate", "")
    print(f"    no token: HTTP {resp.status_code}, WWW-Authenticate: {challenge}")
    assert resp.status_code == 401 and MCP_METADATA_URL in challenge
    metadata = requests.get(MCP_METADATA_URL, verify=False, timeout=15).json()
    print(
        f"    metadata: resource={metadata['resource']} authorization_servers={metadata['authorization_servers']}"
    )
    assert metadata["resource"] == MCP_URL
    resp = mcp_post(api_token, {"jsonrpc": "2.0", "id": 1, "method": "ping"})
    print(f"    a media-api token sent to the MCP server: HTTP {resp.status_code} (expected 401)")
    assert resp.status_code == 401
    resp = requests.get(
        f"{args.api_base}/v1/feed",
        headers={"Authorization": f"Bearer {read_token}"},
        verify=False,
        timeout=15,
    )
    print(f"    an MCP token sent to the api: HTTP {resp.status_code} (expected 401/403: wrong audience)")
    assert resp.status_code in (401, 403)

    step("18c", "MCP session with mcp:read: list tools, whoami, read the feed through the token exchange")
    session_id = open_session(read_token)
    tools_resp = mcp_post(read_token, {"jsonrpc": "2.0", "id": 3, "method": "tools/list"}, session_id)
    tool_names = {t["name"] for t in rpc_result(tools_resp)["result"]["tools"]}
    print(f"    tools: {sorted(tool_names)}")
    assert tool_names == EXPECTED_TOOLS
    is_error, who = tool_text(call_tool(read_token, session_id, "whoami"))
    print(f"    whoami: {who}")
    assert not is_error and who["username"] == args.username
    is_error, feed = tool_text(call_tool(read_token, session_id, "list_feed", {"limit": 5}))
    print(f"    list_feed: {[(f['ownerUsername'], f['filename']) for f in feed['files']]}")
    assert not is_error and any(f["id"] == published_file_id for f in feed["files"])

    step(
        "18d",
        "scope step-up: like_file with only mcp:read -> 403 insufficient_scope; with mcp:write it works",
    )
    resp = call_tool(read_token, session_id, "like_file", {"fileId": published_file_id})
    print(
        f"    read-only token: HTTP {resp.status_code}, WWW-Authenticate: {resp.headers.get('WWW-Authenticate')}"
    )
    assert resp.status_code == 403 and "insufficient_scope" in resp.headers["WWW-Authenticate"]
    write_token = mcp_token(args.auth_base, args.username, args.password, "openid mcp:read mcp:write")
    is_error, liked = call_write_tool(write_token, session_id, "like_file", {"fileId": published_file_id})
    print(f"    write token: {liked}")
    assert not is_error and liked["liked"] is True
    is_error, liked_again = call_write_tool(
        write_token, session_id, "like_file", {"fileId": published_file_id}
    )
    assert not is_error and liked_again["likeCount"] == liked["likeCount"], "like_file must be idempotent"
    requests.delete(
        f"{args.api_base}/v1/files/{published_file_id}/like",
        headers={"Authorization": f"Bearer {api_token}"},
        verify=False,
        timeout=15,
    )  # undo, so the like count asserted elsewhere is unchanged

    step("18e", "a session belongs to its user: alice's valid token with demo's session id -> 404")
    alice_token = mcp_token(args.auth_base, args.alice_username, args.alice_password, "openid mcp:read")
    resp = call_tool(alice_token, session_id, "whoami")
    print(f"    alice using demo's session: HTTP {resp.status_code} (expected 404)")
    assert resp.status_code == 404

    step("18f", "role gate: a valid MCP token without the mcp-user role (admin has none) -> 403")
    admin_token = mcp_token(args.auth_base, args.admin_username, args.admin_password, "openid mcp:read")
    resp = mcp_post(admin_token, {"jsonrpc": "2.0", "id": 1, "method": "ping"})
    print(f"    admin without mcp-user: HTTP {resp.status_code}, {resp.text[:100]}")
    assert resp.status_code == 403

    step("18g", "MCP has its own per-user rate limit (5/s): a burst of tool calls gets 429")
    statuses = [
        call_tool(read_token, session_id, "whoami", wait_out_rate_limit=False).status_code for _ in range(30)
    ]
    print(f"    30 whoami calls -> {statuses.count(200)} accepted, {statuses.count(429)} rate-limited")
    assert 429 in statuses and 200 in statuses
    time.sleep(RATE_LIMIT_WAIT_SECONDS)  # let the window pass so later steps are not throttled
