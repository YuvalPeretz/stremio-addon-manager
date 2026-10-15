/**
 * Deploy Script Step (custom-script installs)
 * Collect install/update scripts, artifact mode, and in-admin relative paths.
 */

import { Alert, Button, Flex, Form, Input, Radio, Space, Typography, Upload } from "antd";
import { FiUpload } from "react-icons/fi";
import type { UploadProps } from "antd";

import type { AddonProduct } from "@stremio-addon-manager/core";
import ShellScriptEditor from "./ShellScriptEditor";

const { Title, Text, Paragraph } = Typography;

/** Default editor content: injected vars stub only (no Gateway deploy boilerplate). */
function starterInstallScript(product: AddonProduct): string {
  const productNotes =
    product === "translated_subtitles"
      ? [
          "# PRODUCT=translated_subtitles is injected by Electron so a shared script can branch.",
          "# Mount LLM_MODELS_DIR and MT_MODELS_DIR on the public container; Python+ct2 or sibling nllb.",
        ]
      : [];
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "# Injected by Electron — use these; keep secrets out of this file",
    ': "${DEPLOY_MODE:=install}"',
    ': "${ADDON_ID:=}"',
    ': "${ADDON_NAME:=}"',
    ': "${ADDON_PASSWORD:=}"',
    ': "${PUBLIC_URL:=}"',
    ': "${MANAGEMENT_URL:=}"',
    "# ADDON_BUILD or ADDON_SOURCE / ADMIN_BUILD or ADMIN_SOURCE depending on artifact mode",
    ': "${ADDON_BUILD:=}"',
    ': "${ADDON_SOURCE:=}"',
    ': "${ADMIN_BUILD:=}"',
    ': "${ADMIN_SOURCE:=}"',
    "# ADDON_ENV / ADMIN_ENV paths when generated",
    ': "${ADDON_ENV:=}"',
    ': "${ADMIN_ENV:=}"',
    ': "${INSTALL_SCRIPT_REL_PATH:=deploy/install.sh}"',
    ': "${UPDATE_SCRIPT_REL_PATH:=deploy/update.sh}"',
    "# When Manager SSH is set in the wizard, Electron uploads trees and injects:",
    ': "${MANAGER_SSH:=}"',
    ': "${ADDON_REMOTE_STAGING:=}"',
    ': "${ADMIN_REMOTE_STAGING:=}"',
    `: "\${PRODUCT:=${product}}"`,
    ...productNotes,
    "",
    'log() { printf \'[deploy] %s\\n\' "$*"; }',
    'log "mode=$DEPLOY_MODE addon=$ADDON_ID ($ADDON_NAME)"',
    'log "public=$PUBLIC_URL management=$MANAGEMENT_URL"',
    'log "manager_ssh=${MANAGER_SSH:-<unset>} remote_addon=${ADDON_REMOTE_STAGING:-<unset>}"',
    "",
    "# TODO: call Gateway agent API (curl over ssh) using remote staging paths when set",
    "#",
    'if [[ -n "${ADDON_REMOTE_STAGING:-}" ]]; then',
    '  log "ADDON already on manager at $ADDON_REMOTE_STAGING — skip upload"',
    "  # agent upload from stagingPath=$ADDON_REMOTE_STAGING",
    "else",
    "  # Fallback (no Manager SSH): tar-over-ssh (needs ssh + tar on PATH)",
    '  # staging="/tmp/stremio-stage/$uid"',
    '  # tar -C "$src" -czf - . | ssh "$MANAGER_SSH" "mkdir -p \'$staging\' && tar -C \'$staging\' -xzf -"',
    "fi",
    "",
  ].join("\n");
}

/** Full Gateway dual-app example (packages/core/examples/gateway-dual-app-deploy.sh). */
const GATEWAY_EXAMPLE_SCRIPT = [
  "#!/usr/bin/env bash",
  "# Example dual-app Gateway deploy script for Stremio Addon Manager (custom_script).",
  "#",
  "# Electron always injects these into the script process (secret-free body — tokens via ADDON_ENV):",
  "#   DEPLOY_MODE=install|update|config",
  "#   ADDON_ID, ADDON_NAME, ADDON_PASSWORD",
  "#   PUBLIC_URL, MANAGEMENT_URL",
  "#   ADDON_BUILD or ADDON_SOURCE   (public artifact tree — which one depends on Artifact mode)",
  "#   ADMIN_BUILD or ADMIN_SOURCE   (admin artifact tree)",
  "#   ADDON_ENV, ADMIN_ENV          (paths to staged env files)",
  "#   INSTALL_SCRIPT_REL_PATH, UPDATE_SCRIPT_REL_PATH",
  "#   MANAGER_SSH                   (from wizard Manager SSH when set)",
  "#   ADDON_REMOTE_STAGING          (when Electron already uploaded the public tree)",
  "#   ADMIN_REMOTE_STAGING          (when Electron already uploaded the admin tree)",
  "#   PRODUCT                      (streaming | translated_subtitles)",
  "#",
  "# Fill Gateway placeholders below. Do NOT hardcode API tokens or passwords here.",
  "#",
  "# Windows (Electron host): Git for Windows (bash), Python 3, OpenSSH (ssh).",
  "#   https://git-scm.com/download/win",
  "# Prefer setting Manager SSH in the wizard so Electron uploads trees (no rsync needed).",
  "# Without remote staging, this script falls back to tar-over-ssh, then rsync if present.",
  "",
  "set -euo pipefail",
  "",
  "# --- injected by Electron (required / with safe fallbacks) ---",
  ": \"${DEPLOY_MODE:?DEPLOY_MODE is required}\"",
  ": \"${ADDON_PASSWORD:?ADDON_PASSWORD is required}\"",
  "",
  "ADDON_ID=\"${ADDON_ID:-unknown-addon}\"",
  "ADDON_NAME=\"${ADDON_NAME:-Stremio Addon}\"",
  "PUBLIC_URL=\"${PUBLIC_URL:-}\"",
  "MANAGEMENT_URL=\"${MANAGEMENT_URL:-}\"",
  "INSTALL_SCRIPT_REL_PATH=\"${INSTALL_SCRIPT_REL_PATH:-deploy/install.sh}\"",
  "UPDATE_SCRIPT_REL_PATH=\"${UPDATE_SCRIPT_REL_PATH:-deploy/update.sh}\"",
  "",
  "# Built mode → ADDON_BUILD / ADMIN_BUILD; Source mode → ADDON_SOURCE / ADMIN_SOURCE",
  "ADDON_TREE=\"${ADDON_BUILD:-${ADDON_SOURCE:-}}\"",
  "ADMIN_TREE=\"${ADMIN_BUILD:-${ADMIN_SOURCE:-}}\"",
  "ADDON_ENV=\"${ADDON_ENV:-}\"",
  "ADMIN_ENV=\"${ADMIN_ENV:-}\"",
  "",
  "# Remote staging paths when Electron uploaded via Manager SSH (preferred)",
  "ADDON_REMOTE_STAGING=\"${ADDON_REMOTE_STAGING:-}\"",
  "ADMIN_REMOTE_STAGING=\"${ADMIN_REMOTE_STAGING:-}\"",
  "",
  "# --- Gateway placeholders (edit for your host; keep secret-free) ---",
  "MANAGER_SSH=\"${MANAGER_SSH:-gateway-user@gateway-host}\"",
  "PUBLIC_UID=\"${PUBLIC_UID:-svc-PUBLIC_REPLACE_ME}\"",
  "ADMIN_UID=\"${ADMIN_UID:-svc-ADMIN_REPLACE_ME}\"",
  "MACHINE_ID=\"${MACHINE_ID:-REPLACE_MACHINE_ID}\"",
  "# Manager agent is localhost-only on the Gateway host; SSH then curl loopback (no curl -k).",
  "MANAGER_BASE=\"${MANAGER_BASE:-http://127.0.0.1:PORT}\"",
  "",
  "# remote | tar | rsync — set by resolve_upload_mode / upload_local_tree",
  "UPLOAD_MODE=\"\"",
  "",
  "log() { printf '[deploy] %s\\n' \"$*\"; }",
  "",
  "require_ssh() {",
  "  command -v ssh >/dev/null || { echo \"ssh is required (Gateway agent API over ssh)\"; exit 1; }",
  "}",
  "",
  "resolve_upload_mode() {",
  "  # Prefer Electron remote staging; else tar-over-ssh; else rsync if present.",
  "  if [[ -n \"${ADDON_REMOTE_STAGING:-}\" && -n \"${ADMIN_REMOTE_STAGING:-}\" ]]; then",
  "    UPLOAD_MODE=remote",
  "    return 0",
  "  fi",
  "  require_ssh",
  "  if command -v tar >/dev/null 2>&1; then",
  "    UPLOAD_MODE=tar",
  "    log \"no ADDON_REMOTE_STAGING — using tar-over-ssh (set Manager SSH in the wizard to skip this)\"",
  "  elif command -v rsync >/dev/null 2>&1; then",
  "    UPLOAD_MODE=rsync",
  "    log \"no ADDON_REMOTE_STAGING — using rsync\"",
  "  else",
  "    echo \"Need ADDON_REMOTE_STAGING (set Manager SSH in wizard), or tar+ssh / rsync for directory uploads\"",
  "    exit 1",
  "  fi",
  "}",
  "",
  "# Upload a local tree to Gateway staging via tar|ssh or rsync (only when Electron did not pre-upload).",
  "upload_local_tree() {",
  "  local src=\"$1\" staging=\"$2\"",
  "  log \"upload $src → ${MANAGER_SSH}:${staging} ($UPLOAD_MODE)\"",
  "  if [[ \"$UPLOAD_MODE\" == \"rsync\" ]]; then",
  "    rsync -az --delete \\",
  "      --exclude node_modules --exclude .git \\",
  "      \"$src\"/ \"${MANAGER_SSH}:${staging}/\"",
  "  else",
  "    # tar-over-ssh: works on Windows Git Bash without rsync",
  "    ssh \"$MANAGER_SSH\" \"rm -rf '${staging}' && mkdir -p '${staging}'\"",
  "    tar -C \"$src\" --exclude=node_modules --exclude=.git -czf - . \\",
  "      | ssh \"$MANAGER_SSH\" \"tar -C '${staging}' -xzf -\"",
  "  fi",
  "}",
  "",
  "# Resolve staging path for agent upload: prefer Electron remote staging.",
  "resolve_staging() {",
  "  local remote_staging=\"$1\" local_tree=\"$2\" uid=\"$3\"",
  "  if [[ -n \"$remote_staging\" ]]; then",
  "    log \"using Electron remote staging for $uid: $remote_staging\"",
  "    printf '%s\\n' \"$remote_staging\"",
  "    return 0",
  "  fi",
  "  local staging=\"/tmp/stremio-stage/${uid}\"",
  "  upload_local_tree \"$local_tree\" \"$staging\"",
  "  printf '%s\\n' \"$staging\"",
  "}",
  "",
  "agent_upload_from_staging() {",
  "  local staging=\"$1\" uid=\"$2\"",
  "  log \"agent upload uid=$uid stagingPath=$staging\"",
  "  # Example: tell Gateway Manager to import from a path already on the Manager host.",
  "  # ssh \"$MANAGER_SSH\" \"curl -fsS -X POST ${MANAGER_BASE}/apps/${uid}/upload -d \\\"stagingPath=${staging}\\\"\"",
  "}",
  "",
  "put_env_file() {",
  "  local uid=\"$1\" env_file=\"$2\"",
  "  log \"PUT env for $uid from $env_file\"",
  "  # Example: scp then Manager replace envFile contents (full replace of tracked keys).",
  "  command -v scp >/dev/null || { echo \"scp is required to push env files\"; exit 1; }",
  "  scp \"$env_file\" \"${MANAGER_SSH}:/tmp/stremio-stage/${uid}.env\"",
  "  # ssh \"$MANAGER_SSH\" \"curl -fsS -X PUT ${MANAGER_BASE}/apps/${uid}/env -d @/tmp/stremio-stage/${uid}.env\"",
  "}",
  "",
  "compose_up() {",
  "  local uid=\"$1\"",
  "  log \"compose up $uid (machine=$MACHINE_ID)\"",
  "  # ssh \"$MANAGER_SSH\" \"curl -fsS -X POST ${MANAGER_BASE}/apps/${uid}/up\"",
  "}",
  "",
  "log \"addon=$ADDON_ID ($ADDON_NAME) mode=$DEPLOY_MODE\"",
  "log \"public=$PUBLIC_URL management=$MANAGEMENT_URL\"",
  "log \"scripts: install=$INSTALL_SCRIPT_REL_PATH update=$UPDATE_SCRIPT_REL_PATH\"",
  "log \"manager_ssh=$MANAGER_SSH remote_addon=${ADDON_REMOTE_STAGING:-<unset>} remote_admin=${ADMIN_REMOTE_STAGING:-<unset>}\"",
  "",
  "case \"$DEPLOY_MODE\" in",
  "  install|update)",
  "    resolve_upload_mode",
  "    : \"${ADDON_TREE:?ADDON_BUILD or ADDON_SOURCE required}\"",
  "    : \"${ADMIN_TREE:?ADMIN_BUILD or ADMIN_SOURCE required}\"",
  "    require_ssh",
  "",
  "    addon_staging=\"$(resolve_staging \"$ADDON_REMOTE_STAGING\" \"$ADDON_TREE\" \"$PUBLIC_UID\")\"",
  "    admin_staging=\"$(resolve_staging \"$ADMIN_REMOTE_STAGING\" \"$ADMIN_TREE\" \"$ADMIN_UID\")\"",
  "",
  "    agent_upload_from_staging \"$addon_staging\" \"$PUBLIC_UID\"",
  "    agent_upload_from_staging \"$admin_staging\" \"$ADMIN_UID\"",
  "",
  "    if [[ -n \"$ADDON_ENV\" && -f \"$ADDON_ENV\" ]]; then",
  "      put_env_file \"$PUBLIC_UID\" \"$ADDON_ENV\"",
  "    fi",
  "    if [[ -n \"$ADMIN_ENV\" && -f \"$ADMIN_ENV\" ]]; then",
  "      put_env_file \"$ADMIN_UID\" \"$ADMIN_ENV\"",
  "    else",
  "      log \"warning: ADMIN_ENV missing — admin stack may lack ENABLE_MANAGEMENT_API=true\"",
  "    fi",
  "    compose_up \"$PUBLIC_UID\"",
  "    compose_up \"$ADMIN_UID\"",
  "    log \"done $DEPLOY_MODE — verify PUBLIC_URL=$PUBLIC_URL MANAGEMENT_URL=$MANAGEMENT_URL\"",
  "    ;;",
  "",
  "  config)",
  "    require_ssh",
  "    : \"${ADDON_ENV:?ADDON_ENV required for config mode}\"",
  "    [[ -f \"$ADDON_ENV\" ]] || { echo \"ADDON_ENV file missing: $ADDON_ENV\"; exit 1; }",
  "    put_env_file \"$PUBLIC_UID\" \"$ADDON_ENV\"",
  "    # Optionally sync shared secrets / management flag to admin without full code upload.",
  "    if [[ -n \"$ADMIN_ENV\" && -f \"$ADMIN_ENV\" ]]; then",
  "      put_env_file \"$ADMIN_UID\" \"$ADMIN_ENV\"",
  "      compose_up \"$ADMIN_UID\"",
  "    fi",
  "    compose_up \"$PUBLIC_UID\"",
  "    log \"done config apply for public stack $PUBLIC_UID (addon=$ADDON_ID)\"",
  "    ;;",
  "",
  "  *)",
  "    echo \"Unknown DEPLOY_MODE=$DEPLOY_MODE\"",
  "    exit 1",
  "    ;;",
  "esac",
  "",
].join("\n");

export interface DeployScriptStepValue {
  artifactMode: "built" | "source";
  updateScriptMode: "same" | "separate";
  installScriptRelPath: string;
  updateScriptRelPath: string;
  installScriptContent: string;
  updateScriptContent?: string;
  injectedVars: string[];
}

const TRANSLATED_SUBTITLES_EXAMPLE_NOTES = [
  "# --- TranslatedSubtitles product notes ---",
  "# Electron injects PRODUCT=translated_subtitles so a shared Gateway script can branch.",
  "# Mount LLM_MODELS_DIR, MT_MODELS_DIR, and subtitle cache on the PUBLIC container only.",
  "# Public image: Python 3 + ctranslate2 + sentencepiece, or sibling MT_SERVER_URL / LLM_SERVER_URL.",
  "# Admin does not need a second LLM or NLLB sidecar; translation runs on the public app.",
  "# On install/update: download the active engine only (GGUF or NLLB CT2 dir) from $ADDON_ENV.",
  "# On config: if llama/nllb are sibling containers, restart them so mmap releases old files.",
  "# Do not put HF URLs or tokens in this script body; read them from $ADDON_ENV.",
  "#",
].join("\n");

interface DeployScriptStepProps {
  value: DeployScriptStepValue | null;
  onChange: (value: DeployScriptStepValue) => void;
  onNext: () => void;
  onBack: () => void;
  product?: AddonProduct;
}

async function readUploadAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

function DeployScriptStep({
  value,
  onChange,
  onNext,
  onBack,
  product = "streaming",
}: DeployScriptStepProps) {
  const isTranslated = product === "translated_subtitles";
  const stubScript = starterInstallScript(product);
  const exampleScript = isTranslated
    ? `${TRANSLATED_SUBTITLES_EXAMPLE_NOTES}\n${GATEWAY_EXAMPLE_SCRIPT}`
    : GATEWAY_EXAMPLE_SCRIPT;
  const [form] = Form.useForm();

  async function handleNext(): Promise<void> {
    try {
      const values = await form.validateFields();
      const next: DeployScriptStepValue = {
        artifactMode: values.artifactMode,
        updateScriptMode: values.updateScriptMode,
        installScriptRelPath: values.installScriptRelPath.trim(),
        updateScriptRelPath: (values.updateScriptRelPath || values.installScriptRelPath).trim(),
        installScriptContent: values.installScriptContent,
        updateScriptContent:
          values.updateScriptMode === "separate" ? values.updateScriptContent : undefined,
        injectedVars: [],
      };
      onChange(next);
      onNext();
    } catch {
      // validation failed
    }
  }

  function makeUploadHandler(field: "installScriptContent" | "updateScriptContent"): UploadProps["beforeUpload"] {
    return async (file) => {
      try {
        const text = await readUploadAsText(file as unknown as File);
        form.setFieldsValue({ [field]: text });
      } catch {
        // ignore
      }
      return false;
    };
  }

  function loadGatewayExample(): void {
    form.setFieldsValue({ installScriptContent: exampleScript });
  }

  function resetInstallStub(): void {
    form.setFieldsValue({ installScriptContent: stubScript });
  }

  return (
    <Flex vertical gap={24}>
      <Flex vertical gap={8}>
        <Title level={4}>Deploy Script</Title>
        <Text type="secondary">
          Provide the Gateway deploy script(s). Scripts are embedded only in the private admin artifact
          and must be secret-free (use env placeholders). Electron runs them locally with injected builds.
        </Text>
      </Flex>

      <Alert
        type="info"
        showIcon
        message="Windows prerequisites"
        description={
          <Paragraph style={{ marginBottom: 0 }}>
            Custom script deploy requires <Text strong>Git for Windows (bash)</Text>,{" "}
            <Text strong>Python 3</Text> (<Text code>python3</Text> or <Text code>py -3</Text> visible to
            Git Bash — enable &quot;Add python.exe to PATH&quot;), and OpenSSH <Text code>ssh</Text> for
            Gateway agent calls. <Text strong>rsync is not required</Text> — set{" "}
            <Text strong>Manager SSH</Text> on the Access URLs step so Electron uploads ADDON/ADMIN via
            SSHManager. Without Manager SSH, your script must self-upload (tar-over-ssh; Load example
            auto-detects).
          </Paragraph>
        }
      />

      <Alert
        type="info"
        showIcon
        message="Injected variables (always passed to the script process)"
        description={
          <Paragraph style={{ marginBottom: 0 }}>
            <Text code>ADDON_ID</Text>, <Text code>ADDON_NAME</Text>, <Text code>ADDON_PASSWORD</Text>,{" "}
            <Text code>PUBLIC_URL</Text>, <Text code>MANAGEMENT_URL</Text>,{" "}
            <Text code>ADDON_BUILD</Text>/<Text code>ADDON_SOURCE</Text>,{" "}
            <Text code>ADMIN_BUILD</Text>/<Text code>ADMIN_SOURCE</Text>,{" "}
            <Text code>ADDON_ENV</Text>, <Text code>ADMIN_ENV</Text>,{" "}
            <Text code>DEPLOY_MODE</Text>, <Text code>PRODUCT</Text>, script path hints. When Manager SSH is set:{" "}
            <Text code>MANAGER_SSH</Text>, <Text code>ADDON_REMOTE_STAGING</Text>,{" "}
            <Text code>ADMIN_REMOTE_STAGING</Text>. The starter stub declares these — add your own deploy
            steps, or use <Text strong>Load example</Text>. Keep the body secret-free; tokens travel only
            via env / <Text code>ADDON_ENV</Text>.
          </Paragraph>
        }
      />

      <Form
        form={form}
        layout="vertical"
        initialValues={{
          artifactMode: "built",
          updateScriptMode: "same",
          installScriptRelPath: "deploy/install.sh",
          updateScriptRelPath: "deploy/update.sh",
          installScriptContent: stubScript,
          updateScriptContent: "",
          ...value,
        }}
      >
        <Form.Item
          label="Artifact mode"
          name="artifactMode"
          rules={[{ required: true }]}
          extra="Built = we stage prebuilt dist you upload; Source = we stage sources so compose/npm can build on target."
        >
          <Radio.Group>
            <Radio.Button value="built">Built (dist)</Radio.Button>
            <Radio.Button value="source">Source</Radio.Button>
          </Radio.Group>
        </Form.Item>

        <Form.Item
          label="Update script"
          name="updateScriptMode"
          rules={[{ required: true }]}
          extra="Same = reuse install script for updates. Separate = provide a dedicated update script."
        >
          <Radio.Group>
            <Radio.Button value="same">Same as install</Radio.Button>
            <Radio.Button value="separate">New / separate</Radio.Button>
          </Radio.Group>
        </Form.Item>

        <Form.Item
          label="Install script path (inside ADMIN artifact)"
          name="installScriptRelPath"
          rules={[{ required: true, message: "Relative path required" }]}
          extra="Relative path INSIDE the ADMIN artifact where Electron will write/embed the install script (default deploy/install.sh). The script you paste below is stored at that path in the admin tree."
        >
          <Input placeholder="deploy/install.sh" />
        </Form.Item>

        <Form.Item noStyle shouldUpdate={(prev, cur) => prev.updateScriptMode !== cur.updateScriptMode}>
          {() =>
            form.getFieldValue("updateScriptMode") === "separate" ? (
              <Form.Item
                label="Update script path (inside ADMIN artifact)"
                name="updateScriptRelPath"
                rules={[{ required: true, message: "Relative path required" }]}
              >
                <Input placeholder="deploy/update.sh" />
              </Form.Item>
            ) : null
          }
        </Form.Item>

        <Form.Item
          label="Install script content"
          name="installScriptContent"
          rules={[
            { required: true, message: "Paste or upload your install script" },
            { min: 20, message: "Script looks too short" },
          ]}
          extra={
            <Space wrap style={{ marginTop: 8 }}>
              <Upload beforeUpload={makeUploadHandler("installScriptContent")} showUploadList={false} accept=".sh,text/*">
                <Button icon={<FiUpload />} size="small">
                  Upload .sh
                </Button>
              </Upload>
              <Button size="small" onClick={loadGatewayExample}>
                Load example
              </Button>
              <Button size="small" type="link" onClick={resetInstallStub}>
                Reset to stub
              </Button>
            </Space>
          }
        >
          <ShellScriptEditor
            minHeight={320}
            placeholder="# Injected vars stub — add your deploy steps, or Load example"
          />
        </Form.Item>

        <Form.Item noStyle shouldUpdate={(prev, cur) => prev.updateScriptMode !== cur.updateScriptMode}>
          {() =>
            form.getFieldValue("updateScriptMode") === "separate" ? (
              <Form.Item
                label="Update script content"
                name="updateScriptContent"
                rules={[{ required: true, message: "Paste or upload your update script" }]}
                extra={
                  <Upload
                    beforeUpload={makeUploadHandler("updateScriptContent")}
                    showUploadList={false}
                    accept=".sh,text/*"
                  >
                    <Button icon={<FiUpload />} size="small" style={{ marginTop: 8 }}>
                      Upload .sh
                    </Button>
                  </Upload>
                }
              >
                <ShellScriptEditor minHeight={240} placeholder="#!/usr/bin/env bash" />
              </Form.Item>
            ) : null
          }
        </Form.Item>
      </Form>

      <Flex justify="space-between">
        <Button onClick={onBack}>Back</Button>
        <Button type="primary" onClick={() => void handleNext()}>
          Next
        </Button>
      </Flex>
    </Flex>
  );
}

export default DeployScriptStep;
