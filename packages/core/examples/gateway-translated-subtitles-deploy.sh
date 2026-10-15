#!/usr/bin/env bash
# Example dual-app Gateway deploy script for TranslatedSubtitles (custom_script).
#
# Same contract as gateway-dual-app-deploy.sh, plus:
#   PRODUCT=translated_subtitles   (always injected by Electron)
#
# This product has NO Real-Debrid / TorBox / STREAM_PROVIDER tokens.
# Do not put HF URLs or tokens in this file — read them from $ADDON_ENV.
#
# Public container should mount:
#   LLM_MODELS_DIR (e.g. /data/models)
#   MT_MODELS_DIR (e.g. /data/models/nllb)
#   subtitle cache (SUBTITLE_CACHE_DIR)
# Admin does not need a second LLM or NLLB sidecar.
#
# The public image must provide Python 3 + ctranslate2 + sentencepiece (for in-app
# mt-sidecar/server.py), OR a sibling already healthy at MT_SERVER_URL
# (default http://127.0.0.1:8082). Same attach-or-spawn pattern as llama-server.
#
# On install/update: if LLM_MODEL_PATH is unset, download LLM_MODEL_URL from $ADDON_ENV
# into LLM_MODELS_DIR / LLM_MODEL_FILENAME and verify size/hash before health checks.
# For NLLB (LLM_MODEL_ID=nllb-200-distilled-600m-int8), download the CT2 directory
# into MT_MODELS_DIR / MT_MODEL_DIR instead — do not start llama.
#
# Electron always injects these into the script process (secret-free body — secrets via ADDON_ENV):
#   DEPLOY_MODE=install|update|config
#   ADDON_ID, ADDON_NAME, ADDON_PASSWORD
#   PUBLIC_URL, MANAGEMENT_URL
#   ADDON_BUILD or ADDON_SOURCE
#   ADMIN_BUILD or ADMIN_SOURCE
#   ADDON_ENV, ADMIN_ENV
#   INSTALL_SCRIPT_REL_PATH, UPDATE_SCRIPT_REL_PATH
#   MANAGER_SSH, ADDON_REMOTE_STAGING, ADMIN_REMOTE_STAGING
#   PRODUCT

set -euo pipefail

: "${DEPLOY_MODE:?DEPLOY_MODE is required}"
: "${ADDON_PASSWORD:?ADDON_PASSWORD is required}"

ADDON_ID="${ADDON_ID:-unknown-addon}"
ADDON_NAME="${ADDON_NAME:-Translated Subtitles}"
PUBLIC_URL="${PUBLIC_URL:-}"
MANAGEMENT_URL="${MANAGEMENT_URL:-}"
INSTALL_SCRIPT_REL_PATH="${INSTALL_SCRIPT_REL_PATH:-deploy/install.sh}"
UPDATE_SCRIPT_REL_PATH="${UPDATE_SCRIPT_REL_PATH:-deploy/update.sh}"
PRODUCT="${PRODUCT:-translated_subtitles}"

ADDON_TREE="${ADDON_BUILD:-${ADDON_SOURCE:-}}"
ADMIN_TREE="${ADMIN_BUILD:-${ADMIN_SOURCE:-}}"
ADDON_ENV="${ADDON_ENV:-}"
ADMIN_ENV="${ADMIN_ENV:-}"

ADDON_REMOTE_STAGING="${ADDON_REMOTE_STAGING:-}"
ADMIN_REMOTE_STAGING="${ADMIN_REMOTE_STAGING:-}"

MANAGER_SSH="${MANAGER_SSH:-gateway-user@gateway-host}"
PUBLIC_UID="${PUBLIC_UID:-svc-PUBLIC_REPLACE_ME}"
ADMIN_UID="${ADMIN_UID:-svc-ADMIN_REPLACE_ME}"
MACHINE_ID="${MACHINE_ID:-REPLACE_MACHINE_ID}"
MANAGER_BASE="${MANAGER_BASE:-http://127.0.0.1:PORT}"

UPLOAD_MODE=""

log() { printf '[deploy] %s\n' "$*"; }

require_ssh() {
  command -v ssh >/dev/null || { echo "ssh is required (Gateway agent API over ssh)"; exit 1; }
}

resolve_upload_mode() {
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

upload_local_tree() {
  local src="$1" staging="$2"
  log "upload $src → ${MANAGER_SSH}:${staging} ($UPLOAD_MODE)"
  if [[ "$UPLOAD_MODE" == "rsync" ]]; then
    rsync -az --delete \
      --exclude node_modules --exclude .git \
      "$src"/ "${MANAGER_SSH}:${staging}/"
  else
    ssh "$MANAGER_SSH" "rm -rf '${staging}' && mkdir -p '${staging}'"
    tar -C "$src" --exclude=node_modules --exclude=.git -czf - . \
      | ssh "$MANAGER_SSH" "tar -C '${staging}' -xzf -"
  fi
}

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
}

put_env_file() {
  local uid="$1" env_file="$2"
  log "PUT env for $uid from $env_file"
  command -v scp >/dev/null || { echo "scp is required to push env files"; exit 1; }
  scp "$env_file" "${MANAGER_SSH}:/tmp/stremio-stage/${uid}.env"
}

compose_up() {
  local uid="$1"
  log "compose up $uid (machine=$MACHINE_ID product=$PRODUCT)"
}

# Optional: download catalog GGUF onto the public data volume before health checks.
maybe_download_model() {
  if [[ -z "${ADDON_ENV:-}" || ! -f "$ADDON_ENV" ]]; then
    return 0
  fi
  # shellcheck disable=SC1090
  set -a
  # Read selected keys only — do not source secrets into the script body unnecessarily.
  LLM_MODEL_PATH="$(grep -E '^LLM_MODEL_PATH=' "$ADDON_ENV" | head -n1 | cut -d= -f2- || true)"
  LLM_MODEL_URL="$(grep -E '^LLM_MODEL_URL=' "$ADDON_ENV" | head -n1 | cut -d= -f2- || true)"
  LLM_MODELS_DIR="$(grep -E '^LLM_MODELS_DIR=' "$ADDON_ENV" | head -n1 | cut -d= -f2- || true)"
  LLM_MODEL_FILENAME="$(grep -E '^LLM_MODEL_FILENAME=' "$ADDON_ENV" | head -n1 | cut -d= -f2- || true)"
  set +a
  if [[ -n "${LLM_MODEL_PATH:-}" ]]; then
    log "LLM_MODEL_PATH set — skip catalog download"
    return 0
  fi
  if [[ -z "${LLM_MODEL_URL:-}" || -z "${LLM_MODELS_DIR:-}" || -z "${LLM_MODEL_FILENAME:-}" ]]; then
    log "model catalog fields missing in ADDON_ENV — leave download to first-boot sidecar"
    return 0
  fi
  log "ensure model ${LLM_MODEL_FILENAME} in ${LLM_MODELS_DIR} (download from ADDON_ENV URL, not this script)"
  # Example: ssh "$MANAGER_SSH" "mkdir -p '${LLM_MODELS_DIR}' && curl -fsSL -o '${LLM_MODELS_DIR}/${LLM_MODEL_FILENAME}' '${LLM_MODEL_URL}'"
}

log "addon=$ADDON_ID ($ADDON_NAME) mode=$DEPLOY_MODE product=$PRODUCT"
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
    maybe_download_model
    compose_up "$PUBLIC_UID"
    compose_up "$ADMIN_UID"
    log "done $DEPLOY_MODE — verify PUBLIC_URL=$PUBLIC_URL MANAGEMENT_URL=$MANAGEMENT_URL"
    ;;

  config)
    require_ssh
    : "${ADDON_ENV:?ADDON_ENV required for config mode}"
    [[ -f "$ADDON_ENV" ]] || { echo "ADDON_ENV file missing: $ADDON_ENV"; exit 1; }
    put_env_file "$PUBLIC_UID" "$ADDON_ENV"
    if [[ -n "$ADMIN_ENV" && -f "$ADMIN_ENV" ]]; then
      put_env_file "$ADMIN_UID" "$ADMIN_ENV"
      compose_up "$ADMIN_UID"
    fi
    compose_up "$PUBLIC_UID"
    # If llama or NLLB is a sibling service (LLM_SERVER_URL / MT_SERVER_URL), restart it after
    # rewriting .env so mmap releases the old files and the active engine loads.
    log "done config apply for public stack $PUBLIC_UID (addon=$ADDON_ID product=$PRODUCT)"
    log "if llama or nllb is a sibling container, restart that service so a model/engine switch takes effect"
    ;;

  *)
    echo "Unknown DEPLOY_MODE=$DEPLOY_MODE"
    exit 1
    ;;
esac
