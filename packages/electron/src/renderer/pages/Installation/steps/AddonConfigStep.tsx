/**
 * Addon Configuration Step
 * Configure addon name, domain, password, and (for local/remote) provider tokens.
 * custom_script: provider + tokens live on Stream Providers step instead.
 */

import { Form, Input, InputNumber, Select, Button, Flex, Typography, Collapse } from "antd";
import { useState } from "react";
import type { AddonProduct } from "@stremio-addon-manager/core";
import { TRANSLATED_SUBTITLES_DEFAULT_PORT } from "@stremio-addon-manager/core/browser";

const { Title, Text } = Typography;

/** Default PORT inside Docker for custom_script dual-app Gateway installs. */
const CUSTOM_SCRIPT_CONTAINER_PORT = 8080;

interface WizardAddonConfig {
  name?: string;
  version?: string;
  domain?: string;
  password?: string;
  port?: number;
  provider?: string;
  torrentLimit?: number;
  realDebridToken?: string;
  alldebridToken?: string;
  premiumizeToken?: string;
  torboxToken?: string;
}

interface AddonConfigStepProps {
  value: WizardAddonConfig | Record<string, unknown> | null;
  onChange: (value: Record<string, unknown>) => void;
  onNext: () => void;
  onBack: () => void;
  /** When custom_script, domain is optional (derived from publicUrl later). */
  installationType?: "local" | "remote" | "custom_script";
  product?: AddonProduct;
}

function AddonConfigStep({
  value,
  onChange,
  onNext,
  onBack,
  installationType,
  product = "streaming",
}: AddonConfigStepProps) {
  const isCustomScript = installationType === "custom_script";
  const isTranslated = product === "translated_subtitles";
  const defaultPort = isCustomScript || isTranslated ? TRANSLATED_SUBTITLES_DEFAULT_PORT : 7000;
  const [form] = Form.useForm();
  const [selectedProvider, setSelectedProvider] = useState<string>(
    typeof value?.provider === "string" ? value.provider : "real-debrid"
  );

  async function handleNext() {
    try {
      await form.validateFields();
      const values = form.getFieldsValue();

      // Local/remote: trim token values entered on this step
      if (!isCustomScript) {
        if (values.realDebridToken) {
          values.realDebridToken = values.realDebridToken.trim();
        }
        if (values.alldebridToken) {
          values.alldebridToken = values.alldebridToken.trim();
        }
        if (values.premiumizeToken) {
          values.premiumizeToken = values.premiumizeToken.trim();
        }
        if (values.torboxToken) {
          values.torboxToken = values.torboxToken.trim();
        }
      } else {
        // Provider + tokens are collected on ProvidersStep for custom_script
        delete values.provider;
        delete values.realDebridToken;
        delete values.alldebridToken;
        delete values.premiumizeToken;
        delete values.torboxToken;
      }

      // custom_script / TranslatedSubtitles: container PORT defaults to 8080
      if (
        (isCustomScript || isTranslated) &&
        (values.port === undefined || values.port === null || values.port === "")
      ) {
        values.port = defaultPort;
      }

      if (isTranslated) {
        delete values.provider;
        delete values.realDebridToken;
        delete values.alldebridToken;
        delete values.premiumizeToken;
        delete values.torboxToken;
        delete values.torrentLimit;
      }

      onChange(values as Record<string, unknown>);
      onNext();
    } catch (error) {
      // Validation failed
    }
  }

  return (
    <Flex vertical gap={24}>
      <Flex vertical gap={8}>
        <Title level={4}>Configure Your Addon</Title>
        <Text type="secondary">
          {isTranslated
            ? "Name, password, and listen port. Target language and model are the next steps. No Real-Debrid token."
            : isCustomScript
              ? "Enter the basic configuration for your Stremio addon. Stream providers and API tokens are set on the next step."
              : "Enter the basic configuration for your Stremio addon."}
        </Text>
      </Flex>

      <Form
        form={form}
        layout="vertical"
        initialValues={{
          name: isTranslated ? "Translated_Subtitles" : "My_Private_Addon",
          version: "1.0.0",
          torrentLimit: 15,
          ...(isCustomScript || isTranslated ? {} : { provider: "real-debrid" }),
          port: defaultPort,
          ...value,
        }}
        onValuesChange={(changedValues) => {
          if (isCustomScript || isTranslated) return;
          if (changedValues.provider !== undefined) {
            setSelectedProvider(changedValues.provider);
            // Clear token fields when switching providers to avoid confusion
            if (changedValues.provider !== selectedProvider) {
              form.setFieldsValue({
                realDebridToken: undefined,
                alldebridToken: undefined,
                premiumizeToken: undefined,
                torboxToken: undefined,
              });
            }
          }
        }}
      >
        <Form.Item
          label="Addon Name"
          name="name"
          rules={[
            { required: true, message: "Please enter addon name" },
            {
              pattern: /^[a-zA-Z0-9_-]+$/,
              message: "Only alphanumeric, dash, and underscore allowed",
            },
          ]}
        >
          <Input placeholder={isTranslated ? "Translated_Subtitles" : "My_Private_Addon"} />
        </Form.Item>

        <Form.Item
          label="Domain"
          name="domain"
          rules={
            isCustomScript
              ? []
              : [
                  { required: true, message: "Please enter your domain" },
                  {
                    pattern: /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
                    message: "Please enter a valid domain",
                  },
                ]
          }
          extra={
            isCustomScript
              ? "Optional for custom script — Access URLs step sets the public base (path prefix OK)."
              : "Example: yourdomain.duckdns.org"
          }
        >
          <Input placeholder={isCustomScript ? "optional — from public URL" : "yourdomain.duckdns.org"} />
        </Form.Item>

        <Form.Item
          label="Addon Password"
          name="password"
          rules={[
            { required: true, message: "Please enter a password" },
            { min: 8, message: "Password must be at least 8 characters" },
          ]}
          extra="This password will be used to access your addon. No special characters to avoid URL encoding issues."
        >
          <Input.Password placeholder="Enter a secure password" />
        </Form.Item>

        {!isCustomScript && !isTranslated && (
          <>
            <Form.Item
              label="Provider"
              name="provider"
              rules={[{ required: true, message: "Please select a provider" }]}
            >
              <Select onChange={(val) => setSelectedProvider(val)}>
                <Select.Option value="real-debrid">Real-Debrid</Select.Option>
                <Select.Option value="alldebrid">AllDebrid</Select.Option>
                <Select.Option value="premiumize">Premiumize</Select.Option>
                <Select.Option value="torbox">TorBox</Select.Option>
              </Select>
            </Form.Item>

            {selectedProvider === "real-debrid" && (
              <Form.Item
                label="Real-Debrid API Token"
                name="realDebridToken"
                rules={[
                  { required: true, message: "Please enter your Real-Debrid API token" },
                  { min: 10, message: "Token must be at least 10 characters" },
                ]}
                extra={
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Get your API token from{" "}
                    <a href="https://real-debrid.com/apitoken" target="_blank" rel="noopener noreferrer">
                      https://real-debrid.com/apitoken
                    </a>
                  </Text>
                }
              >
                <Input.Password placeholder="Enter your Real-Debrid API token" />
              </Form.Item>
            )}

            {selectedProvider === "alldebrid" && (
              <Form.Item
                label="AllDebrid API Token"
                name="alldebridToken"
                rules={[
                  { required: true, message: "Please enter your AllDebrid API token" },
                  { min: 10, message: "Token must be at least 10 characters" },
                ]}
                extra={
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Get your API token from{" "}
                    <a href="https://alldebrid.com/apikeys/" target="_blank" rel="noopener noreferrer">
                      https://alldebrid.com/apikeys/
                    </a>
                  </Text>
                }
              >
                <Input.Password placeholder="Enter your AllDebrid API token" />
              </Form.Item>
            )}

            {selectedProvider === "premiumize" && (
              <Form.Item
                label="Premiumize API Token"
                name="premiumizeToken"
                rules={[
                  { required: true, message: "Please enter your Premiumize API token" },
                  { min: 10, message: "Token must be at least 10 characters" },
                ]}
                extra={
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Get your API token from{" "}
                    <a href="https://www.premiumize.me/account" target="_blank" rel="noopener noreferrer">
                      https://www.premiumize.me/account
                    </a>
                  </Text>
                }
              >
                <Input.Password placeholder="Enter your Premiumize API token" />
              </Form.Item>
            )}

            {selectedProvider === "torbox" && (
              <Form.Item
                label="TorBox API Token"
                name="torboxToken"
                rules={[
                  { required: true, message: "Please enter your TorBox API token" },
                  { min: 10, message: "Token must be at least 10 characters" },
                ]}
                extra={
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Get your API token from your TorBox account settings
                  </Text>
                }
              >
                <Input.Password placeholder="Enter your TorBox API token" />
              </Form.Item>
            )}
          </>
        )}

        {!isTranslated && (
        <Form.Item
          label="Torrent Limit"
          name="torrentLimit"
          rules={[
            { required: true, message: "Please enter torrent limit" },
            {
              type: "number",
              min: 5,
              max: 25,
              message: "Must be between 5 and 25",
            },
          ]}
          extra="Number of torrent options to show (5-25)"
        >
          <InputNumber min={5} max={25} style={{ width: "100%" }} />
        </Form.Item>
        )}

        {isCustomScript ? (
          <Collapse
            ghost
            items={[
              {
                key: "advanced-port",
                label: <Text type="secondary">Advanced — container listen port</Text>,
                children: (
                  <Form.Item
                    label="Container listen port (PORT inside Docker)"
                    name="port"
                    rules={[
                      {
                        type: "number",
                        min: 1024,
                        max: 65535,
                        message: "Must be between 1024 and 65535",
                      },
                    ]}
                    extra="Not the public URL port. Gateway access uses Access URLs. Host publish ports are set in your deploy script (ADDON_HOST_PORT / ADMIN_HOST_PORT). Default 8080 — written to ADDON_ENV / ADMIN_ENV as PORT."
                  >
                    <InputNumber
                      min={1024}
                      max={65535}
                      placeholder={String(CUSTOM_SCRIPT_CONTAINER_PORT)}
                      style={{ width: "100%" }}
                    />
                  </Form.Item>
                ),
              },
            ]}
          />
        ) : (
          <Form.Item
            label="Port"
            name="port"
            rules={[
              { required: true, message: "Please enter a port" },
              {
                type: "number",
                min: 1024,
                max: 65535,
                message: "Must be between 1024 and 65535",
              },
            ]}
          >
            <InputNumber min={1024} max={65535} style={{ width: "100%" }} />
          </Form.Item>
        )}
      </Form>

      <Flex justify="space-between">
        <Button onClick={onBack}>Back</Button>
        <Button type="primary" onClick={handleNext}>
          Next
        </Button>
      </Flex>
    </Flex>
  );
}

export default AddonConfigStep;

