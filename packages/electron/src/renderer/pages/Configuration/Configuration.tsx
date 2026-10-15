/**
 * Configuration Page
 * Manage addon configuration with forms and validation
 */

import { useState, useEffect, type ReactNode } from "react";
import { useAtom } from "jotai";
import {
  Card,
  Flex,
  Typography,
  Button,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Tabs,
  Tag,
  Radio,
  message,
  Modal,
  Space,
  Divider,
  Tooltip,
  Alert,
  Upload,
} from "antd";
import { FiSave, FiRotateCw, FiDownload, FiUpload, FiArrowUp, FiArrowDown } from "react-icons/fi";
import type { UploadProps } from "antd";
import type { AddonManagerConfig } from "@stremio-addon-manager/core";
import {
  DEFAULT_LLM_MODEL_ID,
  DEFAULT_TARGET_LANG,
  LLM_MODEL_CATALOG,
  isTranslatedSubtitlesProduct,
  normalizeAddonProduct,
} from "@stremio-addon-manager/core/browser";
import { configAtom } from "../../atoms/configAtoms";
import { selectedAddonIdAtom } from "../../atoms/addonAtoms";
import { isCustomScriptInstall } from "../../utils/addonUrls";
import EnvironmentVariables from "../EnvironmentVariables/EnvironmentVariables";
import styles from "./Configuration.module.scss";

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

async function readUploadAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

function promptDeployScript(options: {
  title: string;
  description: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    let draft = "";
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const beforeUpload: UploadProps["beforeUpload"] = async (file) => {
      try {
        draft = await readUploadAsText(file as unknown as File);
        modal.update({
          content: renderBody(draft),
        });
        message.success(`Loaded ${file.name}`);
      } catch {
        message.error("Failed to read script file");
      }
      return false;
    };

    function renderBody(value: string): ReactNode {
      return (
        <Flex vertical gap={12}>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            {options.description}
          </Paragraph>
          <Upload beforeUpload={beforeUpload} showUploadList={false} accept=".sh,text/*">
            <Button icon={<FiUpload />}>Pick script file…</Button>
          </Upload>
          <TextArea
            rows={12}
            defaultValue={value}
            placeholder="Paste deploy script here…"
            onChange={(e) => {
              draft = e.target.value;
            }}
            style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}
          />
        </Flex>
      );
    }

    const modal = Modal.confirm({
      title: options.title,
      width: 720,
      icon: null,
      content: renderBody(""),
      okText: "Use script and continue",
      cancelText: "Cancel",
      onOk: () => {
        if (!draft.trim()) {
          message.error("Paste or pick a deploy script first");
          return Promise.reject(new Error("empty script"));
        }
        finish(draft);
        return Promise.resolve();
      },
      onCancel: () => finish(null),
    });
  });
}

function Configuration() {
  const [config, setConfig] = useAtom(configAtom);
  const [selectedAddonId] = useAtom(selectedAddonIdAtom);
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [providerOrder, setProviderOrder] = useState<string[]>(["real-debrid"]);

  function getSSHConfig(): unknown {
    if (!config) return undefined;
    const target = (config as any)?.installation?.target;
    if (!target?.host) return undefined;
    return {
      host: target.host,
      port: target.port || 22,
      username: target.username || "root",
      password: target.password,
      privateKeyPath: target.privateKeyPath,
      passphrase: target.passphrase,
    };
  }

  useEffect(() => {
    loadConfiguration();
  }, [selectedAddonId]);

  async function loadConfiguration() {
    setLoading(true);
    const result = await window.electron.config.load(selectedAddonId || undefined);
    setLoading(false);

    if (result.success) {
      setConfig(result.data as any);
      const loaded = result.data as AddonManagerConfig;
      form.setFieldsValue({
        ...loaded,
        product: normalizeAddonProduct(loaded.product),
        addon: {
          ...loaded.addon,
          targetLang: loaded.addon?.targetLang || DEFAULT_TARGET_LANG,
          llmModelId: loaded.addon?.llmModelId || DEFAULT_LLM_MODEL_ID,
        },
      });
      const loadedOrder = loaded.addon?.streamProviderOrder;
      if (Array.isArray(loadedOrder) && loadedOrder.length > 0) {
        setProviderOrder(loadedOrder);
      }
      setHasChanges(false);
    } else {
      message.error("Failed to load configuration");
    }
  }

  async function applyCustomScriptConfig(
    addonId: string,
    confirmScriptHash?: string,
    scriptContent?: string,
    switchModelId?: string
  ): Promise<boolean> {
    const applyResult = await window.electron.customScript.applyConfig(addonId, {
      confirmScriptHash,
      scriptContent,
    });
    if (applyResult.requiresScript) {
      const pasted = await promptDeployScript({
        title: "Paste/pick deploy script",
        description:
          applyResult.error ||
          "Private admin managementUrl is unreachable and no stored script is available. Paste or pick the deploy script to apply config (DEPLOY_MODE=config).",
      });
      if (!pasted) {
        return false;
      }
      return applyCustomScriptConfig(addonId, confirmScriptHash, pasted, switchModelId);
    }
    if (applyResult.requiresConfirm && applyResult.scriptHash) {
      Modal.confirm({
        title: "Deploy script changed",
        content: `Script hash is now ${applyResult.scriptHash.slice(0, 16)}…. Confirm to apply config with DEPLOY_MODE=config.`,
        okText: "Confirm and apply",
        onOk: async () => {
          const applied = await applyCustomScriptConfig(
            addonId,
            applyResult.scriptHash,
            scriptContent,
            switchModelId
          );
          if (applied && switchModelId) {
            await switchLlmAfterSave(switchModelId);
          }
        },
      });
      return false;
    }
    if (applyResult.success) {
      if (applyResult.warning) {
        message.warning(applyResult.warning, 12);
      } else {
        message.success("Configuration saved and applied via deploy script (DEPLOY_MODE=config)");
      }
      return true;
    }
    message.error(applyResult.error || "Config apply via deploy script failed");
    return false;
  }

  async function switchLlmAfterSave(modelId: string): Promise<void> {
    if (!selectedAddonId || !window.electron.translatedSubtitles?.switchModel) {
      message.warning(
        "Model settings saved. Could not contact the addon to reload llama — it will pick up the new GGUF on next start."
      );
      return;
    }
    const result = await window.electron.translatedSubtitles.switchModel(selectedAddonId, modelId);
    if (result.success) {
      if (result.warning) {
        message.warning(result.warning, 12);
      } else {
        message.success("Translation model switched. Llama reloaded with the new GGUF.");
      }
      return;
    }
    if (result.unreachable) {
      message.warning(
        "Model settings saved. The addon was unreachable. It will prune the old GGUF and download the new file on next start.",
        14
      );
      return;
    }
    message.error(result.error || "Failed to switch the translation model");
  }

  async function handleSave() {
    try {
      await form.validateFields();
      const values = form.getFieldsValue();
      const previousModelId = ((config as AddonManagerConfig | null)?.addon?.llmModelId || "").trim();
      const nextModelId = String(values?.addon?.llmModelId || "").trim();
      const modelChanged = isTranslated && nextModelId.length > 0 && previousModelId !== nextModelId;

      const persist = async (): Promise<void> => {
        setLoading(true);
        const result = await window.electron.config.save(values, selectedAddonId || undefined);

        if (!result.success) {
          setLoading(false);
          message.error(result.error || "Failed to save configuration");
          return;
        }

        const reloaded = await window.electron.config.load(selectedAddonId || undefined);
        if (reloaded.success && reloaded.data) {
          setConfig(reloaded.data as AddonManagerConfig);
          form.setFieldsValue(reloaded.data);
        } else {
          setConfig(values);
        }
        setHasChanges(false);

        const savedAsCustom =
          (reloaded.success && reloaded.data
            ? isCustomScriptInstall(reloaded.data as AddonManagerConfig)
            : false) ||
          isCustomScriptInstall(values as AddonManagerConfig) ||
          (config ? isCustomScriptInstall(config as AddonManagerConfig) : false);

        if (savedAsCustom && selectedAddonId && window.electron.customScript) {
          const applied = await applyCustomScriptConfig(
            selectedAddonId,
            undefined,
            undefined,
            modelChanged ? nextModelId : undefined
          );
          if (applied && modelChanged) {
            await switchLlmAfterSave(nextModelId);
          }
          setLoading(false);
          return;
        }

        const ssh = getSSHConfig();
        const syncResult = await window.electron.env.sync(ssh, selectedAddonId || undefined, false);

        if (modelChanged) {
          await switchLlmAfterSave(nextModelId);
          setLoading(false);
          return;
        }

        setLoading(false);

        if (syncResult.success) {
          const serviceUpdated = syncResult.data?.updated ?? false;
          if (serviceUpdated) {
            Modal.confirm({
              title: "Configuration Saved",
              content:
                "Settings saved and service file updated. Restart the service for the new settings to take effect.",
              okText: "Restart Now",
              cancelText: "Later",
              onOk: async () => {
                await window.electron.service.restart(ssh, selectedAddonId || undefined);
                message.success("Service restarted — new settings are active");
              },
            });
          } else {
            message.success("Configuration saved successfully");
          }
        } else {
          message.warning(
            "Configuration saved, but service file could not be synced. Apply changes manually via Environment Variables → Sync."
          );
        }
      };

      if (modelChanged) {
        Modal.confirm({
          title: "Switch translation model?",
          content:
            "This deletes the previous GGUF in the models directory, then downloads the new file. Llama will reload.",
          okText: "Switch model",
          onOk: persist,
        });
        return;
      }

      await persist();
    } catch (error) {
      setLoading(false);
      message.error("Please fix validation errors");
    }
  }

  function handleReset() {
    Modal.confirm({
      title: "Reset Configuration",
      content: "Are you sure you want to reset to default values? This action cannot be undone.",
      okText: "Reset",
      okType: "danger",
      onOk: () => {
        loadConfiguration();
        setHasChanges(false);
        message.info("Configuration reset");
      },
    });
  }

  function handleExport() {
    const dataStr = JSON.stringify(config, null, 2);
    const dataBlob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "addon-config.json";
    link.click();
    URL.revokeObjectURL(url);
    message.success("Configuration exported");
  }

  function handleImport() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (event: any) => {
        try {
          const importedConfig = JSON.parse(event.target.result);
          form.setFieldsValue(importedConfig);
          setHasChanges(true);
          message.success("Configuration imported. Click Save to apply.");
        } catch (error) {
          message.error("Invalid configuration file");
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function handleValuesChange() {
    setHasChanges(true);
  }

  const isCustomScript =
    Boolean(config && isCustomScriptInstall(config as AddonManagerConfig));
  const isTranslated = isTranslatedSubtitlesProduct(
    (config as AddonManagerConfig | null)?.product
  );

  const tabItems = [
    {
      key: "addon",
      label: "Addon Settings",
      children: (
        <Card>
          {isCustomScript && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="Custom script install"
              description="Saving merges settings into ADDON_ENV (+ ADMIN_ENV) and runs your deploy script with DEPLOY_MODE=config (no SSH service sync). Edit Gateway bases under the Access URLs tab. Rollback and remote→custom_script migrate are not supported."
            />
          )}
          <Form.Item name="product" hidden>
            <Input />
          </Form.Item>

          <Form.Item label="Addon Name" name={["addon", "name"]} rules={[{ required: true }]}>
            <Input />
          </Form.Item>

          <Form.Item
            label="Domain"
            name={["addon", "domain"]}
            rules={isCustomScript ? [] : [{ required: true }]}
            extra={
              isCustomScript
                ? "Optional for custom script — usually derived from publicUrl (host + path prefix)."
                : undefined
            }
          >
            <Input placeholder={isCustomScript ? "gateway.example/svc-xxx" : undefined} />
          </Form.Item>

          <Form.Item label="Password" name={["addon", "password"]} rules={[{ required: true, min: 8 }]}>
            <Input.Password />
          </Form.Item>

          {isTranslated ? (
            <>
              <Form.Item
                label="Target language (TARGET_LANG)"
                name={["addon", "targetLang"]}
                rules={[
                  { required: true, message: "Target language is required" },
                  { pattern: /^[a-zA-Z]{2,3}$/, message: "Use a 2–3 letter ISO 639 code" },
                ]}
                extra="Single ISO 639-2/3 code. The addon always emits one translated track."
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={[
                    { value: "eng", label: "English (eng)" },
                    { value: "heb", label: "Hebrew (heb)" },
                    { value: "spa", label: "Spanish (spa)" },
                    { value: "fra", label: "French (fra)" },
                    { value: "deu", label: "German (deu)" },
                    { value: "ita", label: "Italian (ita)" },
                    { value: "por", label: "Portuguese (por)" },
                    { value: "rus", label: "Russian (rus)" },
                    { value: "ara", label: "Arabic (ara)" },
                    { value: "jpn", label: "Japanese (jpn)" },
                    { value: "kor", label: "Korean (kor)" },
                    { value: "zho", label: "Chinese (zho)" },
                    { value: "hin", label: "Hindi (hin)" },
                    { value: "tur", label: "Turkish (tur)" },
                    { value: "pol", label: "Polish (pol)" },
                    { value: "nld", label: "Dutch (nld)" },
                  ]}
                />
              </Form.Item>

              <Form.Item
                label="Translation model"
                name={["addon", "llmModelId"]}
                rules={[{ required: true, message: "Select a model" }]}
                extra="Changing this deletes the previous GGUF in the models directory, then downloads and loads the new file. No manual sidecar restart is needed when the switch succeeds."
              >
                <Radio.Group style={{ width: "100%" }}>
                  <Flex vertical gap={8}>
                    {LLM_MODEL_CATALOG.map((entry) => (
                      <Radio key={entry.id} value={entry.id}>
                        <Flex vertical gap={0}>
                          <Text>
                            {entry.label}{" "}
                            <Tag>{entry.tier}</Tag>
                            {entry.recommended && <Tag color="blue">Recommended</Tag>}
                            {entry.experimental && <Tag color="orange">Experimental</Tag>}
                          </Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {entry.ramBlurb} · {entry.qualityBlurb}
                          </Text>
                        </Flex>
                      </Radio>
                    ))}
                  </Flex>
                </Radio.Group>
              </Form.Item>
            </>
          ) : (
            <>
              <Form.Item label="Provider" name={["addon", "provider"]} rules={[{ required: true }]}>
                <Select>
                  <Select.Option value="real-debrid">Real-Debrid</Select.Option>
                  <Select.Option value="alldebrid">AllDebrid</Select.Option>
                  <Select.Option value="premiumize">Premiumize</Select.Option>
                  <Select.Option value="torbox">TorBox</Select.Option>
                </Select>
              </Form.Item>

              <Form.Item
                label="Torrent Limit"
                name={["addon", "torrentLimit"]}
                rules={[{ required: true, type: "number", min: 5, max: 25 }]}
              >
                <InputNumber min={5} max={25} style={{ width: "100%" }} />
              </Form.Item>
            </>
          )}

          <Form.Item
            label="Port"
            name={["addon", "port"]}
            rules={[{ required: true, type: "number", min: 1024, max: 65535 }]}
          >
            <InputNumber min={1024} max={65535} style={{ width: "100%" }} />
          </Form.Item>
        </Card>
      ),
    },
    {
      key: "features",
      label: "Features",
      children: (
        <Flex vertical gap={16}>
          {isCustomScript && (
            <Alert
              type="warning"
              showIcon
              message="Most feature toggles do not apply to custom_script"
              description="Firewall, fail2ban, DuckDNS, SSL, and backups are classic SSH-install concerns. Custom-script lifecycle and recovery are owned by your Gateway deploy script. Caching/rate-limit values still flow into ADDON_ENV on Save."
            />
          )}
          <Card title="Security" size="small">
            <Form.Item label="Firewall (UFW)" name={["features", "firewall"]} valuePropName="checked">
              <Switch disabled={isCustomScript} />
            </Form.Item>

            <Form.Item label="fail2ban" name={["features", "fail2ban"]} valuePropName="checked">
              <Switch disabled={isCustomScript} />
            </Form.Item>

            <Form.Item label="Authentication" name={["features", "authentication"]} valuePropName="checked">
              <Switch />
            </Form.Item>
          </Card>

          <Card title="Performance" size="small">
            <Form.Item label="Caching Enabled" name={["features", "caching", "enabled"]} valuePropName="checked">
              <Switch />
            </Form.Item>

            <Form.Item noStyle shouldUpdate>
              {({ getFieldValue }) =>
                getFieldValue(["features", "caching", "enabled"]) && (
                  <>
                    <Form.Item label="Cache TTL (seconds)" name={["features", "caching", "ttl"]}>
                      <InputNumber min={300} max={86400} style={{ width: "100%" }} />
                    </Form.Item>

                    <Form.Item label="Cache Max Size (MB)" name={["features", "caching", "maxSize"]}>
                      <InputNumber min={10} max={1000} style={{ width: "100%" }} />
                    </Form.Item>
                  </>
                )
              }
            </Form.Item>

            <Divider />

            <Form.Item
              label="Rate Limiting Enabled"
              name={["features", "rateLimiting", "enabled"]}
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>

            <Form.Item noStyle shouldUpdate>
              {({ getFieldValue }) =>
                getFieldValue(["features", "rateLimiting", "enabled"]) && (
                  <>
                    <Form.Item label="Stream Requests (per 15 min)" name={["features", "rateLimiting", "stream"]}>
                      <InputNumber min={10} max={200} style={{ width: "100%" }} />
                    </Form.Item>

                    <Form.Item label="Stats Requests (per min)" name={["features", "rateLimiting", "stats"]}>
                      <InputNumber min={10} max={500} style={{ width: "100%" }} />
                    </Form.Item>
                  </>
                )
              }
            </Form.Item>
          </Card>

          <Card title="Maintenance" size="small">
            <Form.Item label="Backups Enabled" name={["features", "backups", "enabled"]} valuePropName="checked">
              <Switch disabled={isCustomScript} />
            </Form.Item>

            <Form.Item noStyle shouldUpdate>
              {({ getFieldValue }) =>
                getFieldValue(["features", "backups", "enabled"]) && (
                  <>
                    <Form.Item label="Frequency" name={["features", "backups", "frequency"]}>
                      <Select>
                        <Select.Option value="daily">Daily</Select.Option>
                        <Select.Option value="weekly">Weekly</Select.Option>
                        <Select.Option value="monthly">Monthly</Select.Option>
                      </Select>
                    </Form.Item>

                    <Form.Item label="Retention (days)" name={["features", "backups", "retention"]}>
                      <InputNumber min={1} max={90} style={{ width: "100%" }} />
                    </Form.Item>
                  </>
                )
              }
            </Form.Item>

            <Divider />

            <Form.Item label="DuckDNS Updater" name={["features", "duckdnsUpdater"]} valuePropName="checked">
              <Switch disabled={isCustomScript} />
            </Form.Item>

            <Form.Item label="Auto-start on Boot" name={["features", "autoStart"]} valuePropName="checked">
              <Switch disabled={isCustomScript} />
            </Form.Item>

            <Form.Item label="SSL/HTTPS" name={["features", "ssl"]} valuePropName="checked">
              <Switch disabled />
            </Form.Item>

            <Form.Item
              label="SSL Email Address"
              name={["features", "sslEmail"]}
              rules={[
                { type: "email", message: "Please enter a valid email address" },
              ]}
              extra="Email address for Let's Encrypt certificate registration and renewal notifications"
            >
              <Input type="email" placeholder="your-email@example.com" />
            </Form.Item>
          </Card>
        </Flex>
      ),
    },
    {
      key: "secrets",
      label: "API Tokens",
      children: (
        <Card>
          {!isTranslated && (
            <>
              <Form.Item label="Real-Debrid Token" name={["secrets", "realDebridToken"]} extra="Your Real-Debrid API token">
                <Input.Password placeholder="Enter Real-Debrid token" />
              </Form.Item>

              <Form.Item
                label="TorBox Token"
                name={["secrets", "torboxToken"]}
                extra="Your TorBox API token (optional — enables TorBox as a stream source)"
              >
                <Input.Password placeholder="Enter TorBox token" />
              </Form.Item>
            </>
          )}

          <Form.Item label="DuckDNS Token" name={["secrets", "duckdnsToken"]} extra="Your DuckDNS token (optional)">
            <Input.Password placeholder="Enter DuckDNS token" />
          </Form.Item>
        </Card>
      ),
    },
    {
      key: "sources",
      label: "Sources",
      children: (
        <Flex vertical gap={16}>
          {/* Hidden field — registers streamProviderOrder so getFieldsValue() includes it on save */}
          <Form.Item name={["addon", "streamProviderOrder"]} hidden noStyle>
            <Input />
          </Form.Item>
          <Card title="Active Providers" size="small">
            <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 12 }}>
              Toggle providers on or off. A provider is only available when its token is set in the API Tokens tab.
            </Text>
            <Form.Item noStyle shouldUpdate>
              {({ getFieldValue }) => {
                const rdToken: string = getFieldValue(["secrets", "realDebridToken"]) ?? "";
                const torboxToken: string = getFieldValue(["secrets", "torboxToken"]) ?? "";

                function toggleProvider(id: string, enabled: boolean): void {
                  const next = enabled
                    ? [...providerOrder.filter((p) => p !== id), id]
                    : providerOrder.filter((p) => p !== id);
                  setProviderOrder(next);
                  form.setFieldValue(["addon", "streamProviderOrder"], next);
                  setHasChanges(true);
                }

                return (
                  <Flex vertical gap={12}>
                    <Flex align="center" gap={12}>
                      <Switch
                        checked={providerOrder.includes("real-debrid")}
                        disabled={!rdToken}
                        onChange={(v) => toggleProvider("real-debrid", v)}
                      />
                      <Flex vertical gap={2}>
                        <Text strong>Real-Debrid</Text>
                        {!rdToken && <Text type="secondary" style={{ fontSize: 12 }}>No token — set in API Tokens tab</Text>}
                      </Flex>
                    </Flex>
                    <Flex align="center" gap={12}>
                      <Switch
                        checked={providerOrder.includes("torbox")}
                        disabled={!torboxToken}
                        onChange={(v) => toggleProvider("torbox", v)}
                      />
                      <Flex vertical gap={2}>
                        <Text strong>TorBox</Text>
                        {!torboxToken && <Text type="secondary" style={{ fontSize: 12 }}>No token — set in API Tokens tab</Text>}
                      </Flex>
                    </Flex>
                  </Flex>
                );
              }}
            </Form.Item>
          </Card>

          <Card title="Query Mode" size="small">
            <Form.Item
              name={["addon", "streamProviderMode"]}
              extra={
                <Flex vertical gap={8} style={{ maxWidth: 720 }}>
                  <Text type="secondary">
                    Parallel: all configured providers run; results merge. Ordered: first provider that returns streams
                    wins; others are skipped.
                  </Text>
                  <Alert
                    type="info"
                    showIcon
                    message="Ordered + Real-Debrid first"
                    description="TorBox runs only when Real-Debrid returns zero streams for that episode. Put TorBox first in priority, or choose Parallel, to surface TorBox together with RD."
                  />
                </Flex>
              }
            >
              <Radio.Group>
                <Space direction="vertical">
                  <Radio value="parallel">
                    <Tooltip title="Runs TorBox alongside Real-Debrid and merges streams (recommended if you want both).">
                      <span>
                        <Text strong>Parallel</Text> — query all providers at once, merge results
                      </span>
                    </Tooltip>
                  </Radio>
                  <Radio value="ordered">
                    <Tooltip title="Higher provider in the list wins. With Real-Debrid above TorBox, TorBox is only used when RD finds nothing.">
                      <span>
                        <Text strong>Ordered</Text> — try in priority order, stop when a provider returns streams
                      </span>
                    </Tooltip>
                  </Radio>
                </Space>
              </Radio.Group>
            </Form.Item>
          </Card>

          <Form.Item noStyle shouldUpdate>
            {({ getFieldValue }) =>
              getFieldValue(["addon", "streamProviderMode"]) === "ordered" && (
                <Card title="Provider Priority" size="small">
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Use arrows to change priority. The first provider with streams wins.
                  </Text>
                  <Flex vertical gap={6} style={{ marginTop: 12 }}>
                    {providerOrder.map((id, idx) => (
                      <Flex key={id} align="center" gap={8}>
                        <Tag style={{ minWidth: 120 }}>
                          {id === "real-debrid" ? "Real-Debrid" : id === "torbox" ? "TorBox" : id}
                        </Tag>
                        <Button
                          size="small"
                          icon={<FiArrowUp />}
                          disabled={idx === 0}
                          onClick={() => {
                            const next = [...providerOrder];
                            [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                            setProviderOrder(next);
                            form.setFieldValue(["addon", "streamProviderOrder"], next);
                            setHasChanges(true);
                          }}
                        />
                        <Button
                          size="small"
                          icon={<FiArrowDown />}
                          disabled={idx === providerOrder.length - 1}
                          onClick={() => {
                            const next = [...providerOrder];
                            [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                            setProviderOrder(next);
                            form.setFieldValue(["addon", "streamProviderOrder"], next);
                            setHasChanges(true);
                          }}
                        />
                      </Flex>
                    ))}
                  </Flex>
                </Card>
              )
            }
          </Form.Item>
        </Flex>
      ),
    },
    {
      key: "connection",
      label: isCustomScript ? "Access URLs" : "Connection",
      children: isCustomScript ? (
        <Flex vertical gap={16}>
          <Alert
            type="info"
            showIcon
            message="Custom script — Gateway bases"
            description="These are full base URLs including any /svc-xxx/ path prefix. Public is Stremio (management off); Management is the private admin app (scripts + GET APIs). Installation type stays custom_script — do not switch to SSH local/remote here."
          />
          {/* Keep type locked so Save cannot silently convert to local/remote */}
          <Form.Item name={["installation", "type"]} hidden>
            <Input />
          </Form.Item>
          <Form.Item name={["installation", "accessMethod"]} hidden>
            <Input />
          </Form.Item>
          <Card title="Gateway URLs" size="small">
            <Form.Item
              label="Public URL (Stremio)"
              name={["installation", "customScript", "publicUrl"]}
              rules={[
                { required: true, message: "Public URL is required" },
                {
                  validator: async (_, v: string) => {
                    if (!v) return;
                    try {
                      const u = new URL(v);
                      if (u.protocol !== "http:" && u.protocol !== "https:") {
                        throw new Error("http(s) only");
                      }
                    } catch {
                      throw new Error("Enter a full http(s) URL including path prefix if any");
                    }
                  },
                },
              ]}
              extra="Used for Stremio manifest links and Dashboard health checks."
            >
              <Input placeholder="https://gateway.example/svc-public" />
            </Form.Item>
            <Form.Item
              label="Management URL (private admin)"
              name={["installation", "customScript", "managementUrl"]}
              rules={[
                { required: true, message: "Management URL is required" },
                {
                  validator: async (_, v: string) => {
                    if (!v) return;
                    try {
                      const u = new URL(v);
                      if (u.protocol !== "http:" && u.protocol !== "https:") {
                        throw new Error("http(s) only");
                      }
                    } catch {
                      throw new Error("Enter a full http(s) URL including path prefix if any");
                    }
                  },
                },
              ]}
              extra="Private admin app with ENABLE_MANAGEMENT_API=true. Must be reachable from this machine."
            >
              <Input placeholder="https://gateway.example/svc-admin" />
            </Form.Item>
            <Form.Item
              label="Health path"
              name={["installation", "customScript", "healthPath"]}
              rules={[{ required: true, message: "Health path required" }]}
            >
              <Input placeholder="/health" />
            </Form.Item>
            <Form.Item
              label="Manager SSH (recommended)"
              name={["installation", "customScript", "managerSsh"]}
              rules={[
                {
                  validator: async (_, v: string) => {
                    const trimmed = (v || "").trim();
                    if (!trimmed) return;
                    if (!/^[^@\s]+@[^@\s]+$/.test(trimmed)) {
                      throw new Error("Use user@host (optional :port), e.g. yuvalpi@192.168.0.50");
                    }
                  },
                },
              ]}
              extra="Electron uploads staged ADDON/ADMIN via SSH before deploy scripts run. Leave empty only if your script uploads itself."
            >
              <Input placeholder="yuvalpi@192.168.0.50" />
            </Form.Item>
            <Form.Item
              label="Manager SSH password (optional)"
              name={["installation", "customScript", "managerSshPassword"]}
              extra="Leave empty for key-only auth (default ~/.ssh). Used on update re-runs when Manager SSH is set."
            >
              <Input.Password placeholder="Optional" autoComplete="new-password" />
            </Form.Item>
          </Card>
        </Flex>
      ) : (
        <Flex vertical gap={16}>
          <Alert
            type="info"
            showIcon
            message="SSH credentials are required for remote addons"
            description="These settings tell the app how to reach your Raspberry Pi (or other remote host). Without them, Update and Restart operations will run locally instead of on the remote machine."
          />
          <Card title="Installation Type" size="small">
            <Form.Item name={["installation", "type"]} label="Type">
              <Select>
                <Select.Option value="remote">Remote (SSH)</Select.Option>
                <Select.Option value="local">Local</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item name={["installation", "accessMethod"]} label="Access Method">
              <Select>
                <Select.Option value="duckdns">DuckDNS</Select.Option>
                <Select.Option value="custom_domain">Custom Domain</Select.Option>
                <Select.Option value="static_ip_domain">Static IP + Domain</Select.Option>
                <Select.Option value="local_network">Local Network</Select.Option>
              </Select>
            </Form.Item>
          </Card>

          <Form.Item noStyle shouldUpdate>
            {({ getFieldValue }) =>
              getFieldValue(["installation", "type"]) === "remote" && (
                <Card title="SSH Target" size="small">
                  <Form.Item
                    label="Host / IP"
                    name={["installation", "target", "host"]}
                    rules={[{ required: true, message: "Host is required for remote installations" }]}
                  >
                    <Input placeholder="192.168.0.50" />
                  </Form.Item>

                  <Form.Item label="Port" name={["installation", "target", "port"]}>
                    <InputNumber min={1} max={65535} style={{ width: "100%" }} placeholder="22" />
                  </Form.Item>

                  <Form.Item
                    label="Username"
                    name={["installation", "target", "username"]}
                    rules={[{ required: true, message: "Username is required" }]}
                  >
                    <Input placeholder="yuvalpi" />
                  </Form.Item>

                  <Form.Item
                    label="Password"
                    name={["installation", "target", "password"]}
                    extra="Used for sudo and for SSH when the server allows password login. Many Pis only allow publickey — set a key path below (or leave blank to auto-use ~/.ssh/id_rsa)."
                  >
                    <Input.Password placeholder="SSH / sudo password" />
                  </Form.Item>

                  <Form.Item
                    label="Private Key Path"
                    name={["installation", "target", "privateKeyPath"]}
                    extra="Absolute path to your SSH private key. If empty, ~/.ssh/id_rsa (or id_ed25519) is tried automatically."
                  >
                    <Input placeholder="C:\Users\You\.ssh\id_rsa" />
                  </Form.Item>
                </Card>
              )
            }
          </Form.Item>

          <Card title="Remote Paths" size="small">
            <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 12 }}>
              Paths on the remote machine where the addon is installed.
            </Text>

            <Form.Item
              label="Addon Directory"
              name={["paths", "addonDirectory"]}
              extra="Directory where server.js lives (ExecStart path)"
            >
              <Input placeholder="/opt/stremio-addon-my-private-addon" />
            </Form.Item>

            <Form.Item label="Nginx Config" name={["paths", "nginxConfig"]}>
              <Input placeholder="/etc/nginx/sites-available/stremio-addon-my-private-addon" />
            </Form.Item>

            <Form.Item label="Service File" name={["paths", "serviceFile"]}>
              <Input placeholder="/etc/systemd/system/stremio-addon-my-private-addon.service" />
            </Form.Item>

            <Form.Item label="Logs Directory" name={["paths", "logs"]}>
              <Input placeholder="/var/log/stremio-addon" />
            </Form.Item>

            <Form.Item label="Backups Directory" name={["paths", "backups"]}>
              <Input placeholder="/var/backups/stremio-addon" />
            </Form.Item>
          </Card>
        </Flex>
      ),
    },
    {
      key: "environment",
      label: "Environment Variables",
      children: <EnvironmentVariables />,
    },
  ];

  if (!config) {
    return (
      <Flex vertical gap={24} className={styles.configuration}>
        <Title level={2}>Configuration</Title>
        <Card>
          <Text>No configuration found. Please run installation first.</Text>
        </Card>
      </Flex>
    );
  }

  return (
    <Flex vertical gap={24} className={styles.configuration}>
      <Flex justify="space-between" align="center">
        <Title level={2}>
          Configuration
          {selectedAddonId && (
            <Text type="secondary" style={{ fontSize: "14px", fontWeight: "normal", marginLeft: 12 }}>
              ({selectedAddonId})
            </Text>
          )}
        </Title>
        <Space>
          <Button icon={<FiUpload />} onClick={handleImport}>
            Import
          </Button>
          <Button icon={<FiDownload />} onClick={handleExport}>
            Export
          </Button>
          <Button icon={<FiRotateCw />} onClick={handleReset} disabled={loading}>
            Reset
          </Button>
          <Button type="primary" icon={<FiSave />} onClick={handleSave} loading={loading} disabled={!hasChanges}>
            Save Changes
          </Button>
        </Space>
      </Flex>

      <Form form={form} layout="vertical" initialValues={config} onValuesChange={handleValuesChange}>
        <Tabs items={isTranslated ? tabItems.filter((item) => item.key !== "sources") : tabItems} />
      </Form>
    </Flex>
  );
}

export default Configuration;
