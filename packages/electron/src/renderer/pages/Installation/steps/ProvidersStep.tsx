/**
 * Providers Step
 * Configure which stream providers are active and how they are combined.
 * custom_script: also collects provider API tokens (not on AddonConfigStep).
 */

import { useState } from "react";
import { Form, Input, Button, Flex, Typography, Card, Switch, Radio, Tag, Space, Divider } from "antd";
import { FiArrowUp, FiArrowDown } from "react-icons/fi";

const { Title, Text } = Typography;

export interface ProvidersStepValue {
  /** Set on custom_script when Real-Debrid is enabled; local/remote keep RD on AddonConfig. */
  realDebridToken?: string;
  torboxToken: string;
  streamProviderMode: "parallel" | "ordered";
  streamProviderOrder: string[];
  /** Primary provider id for addon.provider (first active / ordered). */
  provider?: string;
}

interface ProvidersStepProps {
  value: ProvidersStepValue | null;
  onChange: (value: ProvidersStepValue) => void;
  onNext: () => void;
  onBack: () => void;
  addonConfig: Record<string, unknown> | null;
  /** When custom_script, tokens are entered here instead of AddonConfigStep. */
  installationType?: "local" | "remote" | "custom_script";
}

function ProvidersStep({
  value,
  onChange,
  onNext,
  onBack,
  addonConfig,
  installationType,
}: ProvidersStepProps) {
  const isCustomScript = installationType === "custom_script";
  const [form] = Form.useForm();

  // Local/remote: RD token comes from AddonConfigStep
  const addonRdToken = String(
    (addonConfig as { realDebridToken?: string } | null)?.realDebridToken ?? ""
  ).trim();
  const addonTorboxToken = String(
    (addonConfig as { torboxToken?: string } | null)?.torboxToken ?? ""
  ).trim();

  const initialRdToken = value?.realDebridToken ?? (isCustomScript ? "" : addonRdToken);
  const initialTorboxToken = value?.torboxToken ?? addonTorboxToken;

  // custom_script first visit: enable RD by default so the token field is visible
  const [rdEnabled, setRdEnabled] = useState(
    isCustomScript ? (value ? initialRdToken.length > 0 : true) : addonRdToken.length > 0
  );
  const [torboxEnabled, setTorboxEnabled] = useState(initialTorboxToken.length > 0);
  const [mode, setMode] = useState<"parallel" | "ordered">(value?.streamProviderMode ?? "parallel");
  const [order, setOrder] = useState<string[]>(value?.streamProviderOrder ?? ["real-debrid", "torbox"]);

  // Classic flow: RD is read-only from prior step
  const rdConfiguredClassic = !isCustomScript && addonRdToken.length > 0;

  function moveUp(index: number): void {
    if (index === 0) return;
    const newOrder = [...order];
    [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
    setOrder(newOrder);
  }

  function moveDown(index: number): void {
    if (index === order.length - 1) return;
    const newOrder = [...order];
    [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
    setOrder(newOrder);
  }

  function getProviderLabel(id: string): string {
    if (id === "real-debrid") return "Real-Debrid";
    if (id === "torbox") return "TorBox";
    return id;
  }

  async function handleNext(): Promise<void> {
    try {
      const fieldsToValidate: string[] = [];
      if (isCustomScript && rdEnabled) fieldsToValidate.push("realDebridToken");
      if (torboxEnabled) fieldsToValidate.push("torboxToken");
      if (fieldsToValidate.length > 0) {
        await form.validateFields(fieldsToValidate);
      }

      const values = form.getFieldsValue();
      const realDebridToken: string = isCustomScript
        ? rdEnabled
          ? String(values.realDebridToken ?? "").trim()
          : ""
        : addonRdToken;
      const torboxToken: string = torboxEnabled ? String(values.torboxToken ?? "").trim() : "";

      const rdActive = realDebridToken.length > 0;
      const torboxActive = torboxEnabled && torboxToken.length > 0;

      const activeProviders: string[] = [];
      if (rdActive) activeProviders.push("real-debrid");
      if (torboxActive) activeProviders.push("torbox");

      const filteredOrder = order.filter((id) => activeProviders.includes(id));
      for (const id of activeProviders) {
        if (!filteredOrder.includes(id)) filteredOrder.push(id);
      }

      const finalMode: "parallel" | "ordered" = activeProviders.length > 1 ? mode : "parallel";
      const finalOrder = filteredOrder.length > 0 ? filteredOrder : activeProviders;

      onChange({
        ...(isCustomScript ? { realDebridToken, provider: finalOrder[0] || (rdActive ? "real-debrid" : torboxActive ? "torbox" : "real-debrid") } : {}),
        torboxToken,
        streamProviderMode: finalMode,
        streamProviderOrder: finalOrder,
      });
      onNext();
    } catch {
      // Validation failed
    }
  }

  const rdWillBeActive = isCustomScript ? rdEnabled : rdConfiguredClassic;
  const bothEnabled = rdWillBeActive && torboxEnabled;
  const canProceed = isCustomScript
    ? rdEnabled || torboxEnabled
    : rdConfiguredClassic || torboxEnabled;

  return (
    <Flex vertical gap={24}>
      <Flex vertical gap={8}>
        <Title level={4}>Stream Providers</Title>
        <Text type="secondary">
          {isCustomScript
            ? "Enable providers and enter API tokens. Tokens are written to ADDON_ENV for your deploy script."
            : "Configure which services provide streams for your addon. You can combine multiple providers for broader coverage."}
        </Text>
      </Flex>

      <Form
        form={form}
        layout="vertical"
        initialValues={{
          realDebridToken: initialRdToken,
          torboxToken: initialTorboxToken,
        }}
      >
        <Flex vertical gap={12}>
          {/* Real-Debrid */}
          <Card size="small">
            <Flex vertical gap={12}>
              <Flex justify="space-between" align="center">
                <Flex vertical gap={4}>
                  <Text strong>Real-Debrid</Text>
                  {isCustomScript ? (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Primary stream provider for most content
                    </Text>
                  ) : rdConfiguredClassic ? (
                    <Tag color="success">Configured</Tag>
                  ) : (
                    <Tag color="warning">No token — enter in previous step</Tag>
                  )}
                </Flex>
                {isCustomScript ? (
                  <Switch
                    checked={rdEnabled}
                    onChange={(checked) => {
                      setRdEnabled(checked);
                      if (!checked) {
                        form.setFieldValue("realDebridToken", "");
                      }
                    }}
                  />
                ) : (
                  <Switch checked={rdConfiguredClassic} disabled />
                )}
              </Flex>

              {isCustomScript && rdEnabled && (
                <Form.Item
                  label="Real-Debrid API Token"
                  name="realDebridToken"
                  rules={[
                    { required: true, message: "Enter your Real-Debrid API token" },
                    { min: 10, message: "Token must be at least 10 characters" },
                  ]}
                  extra={
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Get your API token from{" "}
                      <a
                        href="https://real-debrid.com/apitoken"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        real-debrid.com/apitoken
                      </a>
                    </Text>
                  }
                  style={{ marginBottom: 0 }}
                >
                  <Input.Password placeholder="Enter your Real-Debrid API token" />
                </Form.Item>
              )}
            </Flex>
          </Card>

          {/* TorBox */}
          <Card size="small">
            <Flex vertical gap={12}>
              <Flex justify="space-between" align="center">
                <Flex vertical gap={4}>
                  <Text strong>TorBox</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Unaffected by RD content filtering — good fallback for blocked content
                  </Text>
                </Flex>
                <Switch
                  checked={torboxEnabled}
                  onChange={(checked) => {
                    setTorboxEnabled(checked);
                    if (!checked) {
                      form.setFieldValue("torboxToken", "");
                    }
                  }}
                />
              </Flex>

              {torboxEnabled && (
                <Form.Item
                  label="TorBox API Token"
                  name="torboxToken"
                  rules={[
                    { required: true, message: "Enter your TorBox API token" },
                    { min: 10, message: "Token must be at least 10 characters" },
                  ]}
                  extra={
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Find your API token in TorBox account settings
                    </Text>
                  }
                  style={{ marginBottom: 0 }}
                >
                  <Input.Password placeholder="Enter your TorBox API token" />
                </Form.Item>
              )}
            </Flex>
          </Card>

          {/* Mode + Order — only when both providers active */}
          {bothEnabled && (
            <Card size="small" title="Multi-Provider Settings">
              <Form.Item label="Query Mode">
                <Radio.Group value={mode} onChange={(e) => setMode(e.target.value as "parallel" | "ordered")}>
                  <Space direction="vertical">
                    <Radio value="parallel">
                      <Text strong>Parallel</Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Both providers queried at the same time — results merged together
                      </Text>
                    </Radio>
                    <Radio value="ordered">
                      <Text strong>Ordered</Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Try the first provider; only fall back to the next if no streams found
                      </Text>
                    </Radio>
                  </Space>
                </Radio.Group>
              </Form.Item>

              {mode === "ordered" && (
                <>
                  <Divider style={{ margin: "8px 0" }} />
                  <Form.Item label="Priority Order" extra="Use arrows to change priority">
                    <Flex vertical gap={6}>
                      {order.map((id, idx) => (
                        <Flex key={id} align="center" gap={8}>
                          <Tag style={{ minWidth: 120 }}>{getProviderLabel(id)}</Tag>
                          <Button
                            size="small"
                            icon={<FiArrowUp />}
                            disabled={idx === 0}
                            onClick={() => moveUp(idx)}
                          />
                          <Button
                            size="small"
                            icon={<FiArrowDown />}
                            disabled={idx === order.length - 1}
                            onClick={() => moveDown(idx)}
                          />
                        </Flex>
                      ))}
                    </Flex>
                  </Form.Item>
                </>
              )}
            </Card>
          )}
        </Flex>
      </Form>

      <Flex justify="space-between">
        <Button onClick={onBack}>Back</Button>
        <Button type="primary" onClick={() => void handleNext()} disabled={!canProceed}>
          Next
        </Button>
      </Flex>
    </Flex>
  );
}

export default ProvidersStep;
