# Custom script install (dual Gateway apps)

## Overview

Custom-script installs deploy **two** Gateway apps:

| App | URL config | Role |
| --- | --- | --- |
| Public (Stremio) | `publicUrl` | Manifest, streams, `/health` — `ENABLE_MANAGEMENT_API=false` |
| Private (admin) | `managementUrl` | Deploy scripts + management GET APIs — `ENABLE_MANAGEMENT_API=true` |

Electron stages `ADDON_*` + `ADMIN_*`, embeds scripts only in the admin tree, and runs your `.sh` locally with injected env (`ADDON_ENV` with `ENABLE_MANAGEMENT_API=false`, `ADMIN_ENV` with `ENABLE_MANAGEMENT_API=true`).

## Manager SSH (recommended)

On the **Access URLs** wizard step (or Configuration → Access URLs), set **Manager SSH** to `user@host` (e.g. `yuvalpi@192.168.0.50`).

When set, Electron uploads the staged ADDON and ADMIN trees to the Gateway Manager host via `SSHManager` (default `~/.ssh` keys) **before** your script runs, and injects:

- `MANAGER_SSH`
- `ADDON_REMOTE_STAGING` — e.g. `/tmp/stremio-cs-addon-{id}-{ts}`
- `ADMIN_REMOTE_STAGING` — e.g. `/tmp/stremio-cs-admin-{id}-{ts}`

Your script should call the Gateway agent API (curl over ssh) using those remote paths — **no rsync on Windows**.

If Manager SSH is unset, Electron skips the upload; your script must upload itself (tar-over-ssh or rsync).

## Windows prerequisites

- **Git for Windows** (provides `bash`) — https://git-scm.com/download/win  
- **OpenSSH client** (`ssh` — Windows Optional Feature or Git’s OpenSSH) for Gateway agent API calls  
- **Python 3** visible to Git Bash (`python3` or `py -3`)  
- **rsync is not required** when Manager SSH is set  

Pure PowerShell deploy scripts are not supported in v1.

## Example script

See [`gateway-dual-app-deploy.sh`](./gateway-dual-app-deploy.sh) for streaming. For TranslatedSubtitles, see [`gateway-translated-subtitles-deploy.sh`](./gateway-translated-subtitles-deploy.sh) (same contract plus `PRODUCT=translated_subtitles`, model dir volume, no RD tokens). The Electron wizard **Load example** prepends those notes when this product is selected. Prefer `ADDON_REMOTE_STAGING` / `ADMIN_REMOTE_STAGING` when present; otherwise fall back to tar-over-ssh, then rsync if available.

Copy into the wizard (or your admin artifact at `deploy/install.sh`). Keep the file **secret-free**; use env placeholders for SSH host, UIDs, and machine id — tokens travel only via `ADDON_ENV` / `ADMIN_ENV`.

## Deferred (unsupported for now)

- Automatic **remote → custom_script** migration (re-install manually)
- **Rollback / backups** for custom-script deploys (Gateway/script responsibility)
- **Party server** deploy via Electron SSH for custom-script addons
