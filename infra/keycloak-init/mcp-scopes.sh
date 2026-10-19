#!/bin/sh
# Creates the MCP client scopes and attaches them to media-mcp as optional scopes.
# Why not in media-realm.json: a realm import that lists `clientScopes` replaces Keycloak's
# built-in ones (basic, profile, roles), and tokens lose sub / preferred_username / realm_access.
# Idempotent: safe to run on every `make up`.
set -eu
KCADM=/opt/keycloak/bin/kcadm.sh
$KCADM config credentials --server http://keycloak:8080 --realm master \
  --user admin --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" >/dev/null

scope_id() { $KCADM get client-scopes -r media --fields id,name --format csv --noquotes | grep ",$1\$" | cut -d, -f1; }

create_scope() {
  [ -n "$(scope_id "$1")" ] && return
  $KCADM create client-scopes -r media -s "name=$1" -s "description=$2" -s protocol=openid-connect \
    -s 'attributes."include.in.token.scope"=true' -s 'attributes."display.on.consent.screen"=true' >/dev/null
}

create_scope mcp:read  "MCP tools that only read: whoami, list_feed, list_my_files, get_file"
create_scope mcp:write "MCP tools that change state: like_file, follow_user"

client_id=$($KCADM get clients -r media -q clientId=media-mcp --fields id --format csv --noquotes)
for scope in mcp:read mcp:write; do
  $KCADM update "clients/$client_id/optional-client-scopes/$(scope_id "$scope")" -r media
done
echo "mcp scopes ready"
