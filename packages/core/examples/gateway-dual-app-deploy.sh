#!/usr/bin/env bash
# Example dual-app Gateway deploy script for Stremio Addon Manager (custom_script).
#
# Electron always injects these into the script process (secret-free body — tokens via ADDON_ENV):
#   DEPLOY_MODE=install|update|config
#   ADDON_ID, ADDON_NAME, ADDON_PASSWORD
#   PUBLIC_URL, MANAGEMENT_URL
#   ADDON_BUILD or ADDON_SOURCE   (public artifact tree — which one depends on Artifact mode)
#   ADMIN_BUILD or ADMIN_SOURCE   (admin artifact tree)
#   ADDON_ENV, ADMIN_ENV          (paths to staged env files)
#   INSTALL_SCRIPT_REL_PATH, UPDATE_SCRIPT_REL_PATH
#   MANAGER_SSH                   (from wizard Manager SSH when set)
#   ADDON_REMOTE_STAGING          (when Electron already uploaded the public tree)
#   ADMIN_REMOTE_STAGING          (when Electron already uploaded the admin tree)
#
# Fill Gateway placeholders below. Do NOT hardcode API tokens or passwords here.
#
# Windows (Electron host): Git for Windows (bash), Python 3, OpenSSH (ssh).
#   https://git-scm.com/download/win
# Prefer setting Manager SSH in the wizard so Electron uploads trees (no rsync needed).
# Without remote staging, this script falls back to tar-over-ssh, then rsync if present.

set -euo pipefail

# --- injected by Electron (required / with safe fallbacks) ---
: "${DEPLOY_MODE:?DEPLOY_MODE is required}"
: "${ADDON_PASSWORD:?ADDON_PASSWORD is required}"

ADDON_ID="${ADDON_ID:-unknown-addon}"
ADDON_NAME="${ADDON_NAME:-Stremio Addon}"
PUBLIC_URL="${PUBLIC_URL:-}"
MANAGEMENT_URL="${MANAGEMENT_URL:-}"
INSTALL_SCRIPT_REL_PATH="${INSTALL_SCRIPT_REL_PATH:-deploy/install.sh}"
UPDATE_SCRIPT_REL_PATH="${UPDATE_SCRIPT_REL_PATH:-deploy/update.sh}"

# Built mode → ADDON_BUILD / ADMIN_BUILD; Source mode → ADDON_SOURCE / ADMIN_SOURCE
ADDON_TREE="${ADDON_BUILD:-${ADDON_SOURCE:-}}"
ADMIN_TREE="${ADMIN_BUILD:-${ADMIN_SOURCE:-}}"
ADDON_ENV="${ADDON_ENV:-}"
ADMIN_ENV="${ADMIN_ENV:-}"

# Remote staging paths when Electron uploaded via Manager SSH (preferred)
ADDON_REMOTE_STAGING="${ADDON_REMOTE_STAGING:-}"
ADMIN_REMOTE_STAGING="${ADMIN_REMOTE_STAGING:-}"

# --- Gateway placeholders (edit for your host; keep secret-free) ---
MANAGER_SSH="${MANAGER_SSH:-gateway-user@gateway-host}"
PUBLIC_UID="${PUBLIC_UID:-svc-PUBLIC_REPLACE_ME}"
ADMIN_UID="${ADMIN_UID:-svc-ADMIN_REPLACE_ME}"
MACHINE_ID="${MACHINE_ID:-REPLACE_MACHINE_ID}"
# Manager agent is localhost-only on the Gateway host; SSH then curl loopback (no curl -k).
MANAGER_BASE="${MANAGER_BASE:-http://127.0.0.1:PORT}"

# remote | tar | rsync — set by resolve_upload_mode / upload_local_tree
UPLOAD_MODE=""

log() { printf '[deploy] %s\n' "$*"; }

require_ssh() {
  command -v ssh >/dev/null || { echo "ssh is required (Gateway agent API over ssh)"; exit 1; }
}

resolve_upload_mode() {
  # Prefer Electron remote staging; else tar-over-ssh; else rsync if present.
  if [[ -n "${ADDON_REMOTE_STAGING:-}" && -n "${ADMIN_REMOTE_STAGING:-}" ]]; then
    UPLOAD_MODE=remote
    return 0
  fi
  require_ssh
  if command -v tar >/dev/null 2>&1; then
    UPLOAD_MODE=tar
    log "no ADDON_REMOTE_STAGING — using tar-over-ssh (set Manager SSH in the wizard to skip this)"
  elif command -v rsync >/dev/null 2>&1; then
    UPLOAD_MODE=rsync
    log "no ADDON_REMOTE_STAGING — using rsync"
  else
    echo "Need ADDON_REMOTE_STAGING (set Manager SSH in wizard), or tar+ssh / rsync for directory uploads"
    exit 1
  fi
}

# Upload a local tree to Gateway staging via tar|ssh or rsync (only when Electron did not pre-upload).
upload_local_tree() {
  local src="$1" staging="$2"
  log "upload $src → ${MANAGER_SSH}:${staging} ($UPLOAD_MODE)"
  if [[ "$UPLOAD_MODE" == "rsync" ]]; then
    rsync -az --delete \
      --exclude node_modules --exclude .git \
      "$src"/ "${MANAGER_SSH}:${staging}/"
  else
    # tar-over-ssh: works on Windows Git Bash without rsync
    ssh "$MANAGER_SSH" "rm -rf '${staging}' && mkdir -p '${staging}'"
    tar -C "$src" --exclude=node_modules --exclude=.git -czf - . \
      | ssh "$MANAGER_SSH" "tar -C '${staging}' -xzf -"
  fi
}

# Resolve staging path for agent upload: prefer Electron remote staging.
resolve_staging() {
  local remote_staging="$1" local_tree="$2" uid="$3"
  if [[ -n "$remote_staging" ]]; then
    log "using Electron remote staging for $uid: $remote_staging"
    printf '%s\n' "$remote_staging"
    return 0
  fi
  local staging="/tmp/stremio-stage/${uid}"
  upload_local_tree "$local_tree" "$staging"
  printf '%s\n' "$staging"
}

agent_upload_from_staging() {
  local staging="$1" uid="$2"
  log "agent upload uid=$uid stagingPath=$staging"
  # Example: tell Gateway Manager to import from a path already on the Manager host.
  # ssh "$MANAGER_SSH" "curl -fsS -X POST ${MANAGER_BASE}/apps/${uid}/upload -d \"stagingPath=${staging}\""
}

put_env_file() {
  local uid="$1" env_file="$2"
  log "PUT env for $uid from $env_file"
  # Example: scp then Manager replace envFile contents (full replace of tracked keys).
  command -v scp >/dev/null || { echo "scp is required to push env files"; exit 1; }
  scp "$env_file" "${MANAGER_SSH}:/tmp/stremio-stage/${uid}.env"
  # ssh "$MANAGER_SSH" "curl -fsS -X PUT ${MANAGER_BASE}/apps/${uid}/env -d @/tmp/stremio-stage/${uid}.env"
}

compose_up() {
  local uid="$1"
  log "compose up $uid (machine=$MACHINE_ID)"
  # ssh "$MANAGER_SSH" "curl -fsS -X POST ${MANAGER_BASE}/apps/${uid}/up"
}

log "addon=$ADDON_ID ($ADDON_NAME) mode=$DEPLOY_MODE"
log "public=$PUBLIC_URL management=$MANAGEMENT_URL"
log "scripts: install=$INSTALL_SCRIPT_REL_PATH update=$UPDATE_SCRIPT_REL_PATH"
log "manager_ssh=$MANAGER_SSH remote_addon=${ADDON_REMOTE_STAGING:-<unset>} remote_admin=${ADMIN_REMOTE_STAGING:-<unset>}"

case "$DEPLOY_MODE" in
  install|update)
    resolve_upload_mode
    : "${ADDON_TREE:?ADDON_BUILD or ADDON_SOURCE required}"
    : "${ADMIN_TREE:?ADMIN_BUILD or ADMIN_SOURCE required}"
    require_ssh

    addon_staging="$(resolve_staging "$ADDON_REMOTE_STAGING" "$ADDON_TREE" "$PUBLIC_UID")"
    admin_staging="$(resolve_staging "$ADMIN_REMOTE_STAGING" "$ADMIN_TREE" "$ADMIN_UID")"

    agent_upload_from_staging "$addon_staging" "$PUBLIC_UID"
    agent_upload_from_staging "$admin_staging" "$ADMIN_UID"

    if [[ -n "$ADDON_ENV" && -f "$ADDON_ENV" ]]; then
      put_env_file "$PUBLIC_UID" "$ADDON_ENV"
    fi
    if [[ -n "$ADMIN_ENV" && -f "$ADMIN_ENV" ]]; then
      put_env_file "$ADMIN_UID" "$ADMIN_ENV"
    else
      log "warning: ADMIN_ENV missing — admin stack may lack ENABLE_MANAGEMENT_API=true"
    fi
    compose_up "$PUBLIC_UID"
    compose_up "$ADMIN_UID"
    log "done $DEPLOY_MODE — verify PUBLIC_URL=$PUBLIC_URL MANAGEMENT_URL=$MANAGEMENT_URL"
    ;;

  config)
    require_ssh
    : "${ADDON_ENV:?ADDON_ENV required for config mode}"
    [[ -f "$ADDON_ENV" ]] || { echo "ADDON_ENV file missing: $ADDON_ENV"; exit 1; }
    put_env_file "$PUBLIC_UID" "$ADDON_ENV"
    # Optionally sync shared secrets / management flag to admin without full code upload.
    if [[ -n "$ADMIN_ENV" && -f "$ADMIN_ENV" ]]; then
      put_env_file "$ADMIN_UID" "$ADMIN_ENV"
      compose_up "$ADMIN_UID"
    fi
    compose_up "$PUBLIC_UID"
    log "done config apply for public stack $PUBLIC_UID (addon=$ADDON_ID)"
    ;;

  *)
    echo "Unknown DEPLOY_MODE=$DEPLOY_MODE"
    exit 1
    ;;
esac
