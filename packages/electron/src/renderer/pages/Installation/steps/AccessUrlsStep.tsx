/**
 * Access URLs Step (custom-script installs)
 * publicUrl (Stremio) + managementUrl (private admin), optional health path.
 */

import { Alert, Button, Flex, Form, Input, Typography } from "antd";
import type { AddonProduct } from "@stremio-addon-manager/core";

const { Title, Text, Paragraph } = Typography;

export interface AccessUrlsStepValue {
  publicUrl: string;
  managementUrl: string;
  healthPath: string;
  /**
   * Gateway Manager SSH target (`user@host` or `user@host:port`).
   * Recommended: Electron uploads staged ADDON/ADMIN trees before the script runs.
   */
  managerSsh?: string;
  /** Optional SSH password for Manager uploads; leave empty for key-only auth. */
  managerSshPassword?: string;
}

interface AccessUrlsStepProps {
  value: AccessUrlsStepValue | null;
  onChange: (value: AccessUrlsStepValue) => void;
  onNext: () => void;
  onBack: () => void;
  product?: AddonProduct;
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function AccessUrlsStep({
  value,
  onChange,
  onNext,
  onBack,
  product = "streaming",
}: AccessUrlsStepProps) {
  const isTranslated = product === "translated_subtitles";
  const [form] = Form.useForm();

  async function handleNext(): Promise<void> {
    try {
      const values = await form.validateFields();
      onChange({
        publicUrl: values.publicUrl.trim().replace(/\/+$/, ""),
        managementUrl: values.managementUrl.trim().replace(/\/+$/, ""),
        healthPath: (values.healthPath || "/health").trim() || "/health",
        managerSsh: (values.managerSsh || "").trim() || undefined,
        managerSshPassword: (values.managerSshPassword || "").trim() || undefined,
      });
      onNext();
    } catch {
      // validation failed
    }
  }

  return (
    <Flex vertical gap={24}>
      <Flex vertical gap={8}>
        <Title level={4}>Access URLs</Title>
        <Text type="secondary">
          Enter the full Gateway base URLs including any path prefix (e.g.{" "}
          <Text code>https://host/svc-xxx</Text>). Do not use host-only domains.
        </Text>
      </Flex>

      <Alert
        type="warning"
        showIcon
        message="Dual Gateway apps"
        description={
          <Paragraph style={{ marginBottom: 0 }}>
            <Text strong>Public URL</Text> is the WAN-facing{" "}
            {isTranslated ? "Translated Subtitles addon" : "Stremio streaming addon"} (management API
            off). <Text strong>Management URL</Text> is the private admin app (LAN/Tailscale) that hosts
            deploy scripts and management GET APIs. Electron fetches scripts only from the management
            URL.
          </Paragraph>
        }
      />

      <Form
        form={form}
        layout="vertical"
        initialValues={{
          publicUrl: "",
          managementUrl: "",
          healthPath: "/health",
          managerSsh: "",
          managerSshPassword: "",
          ...value,
        }}
      >
        <Form.Item
          label="Manager SSH (recommended)"
          name="managerSsh"
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
          extra="Electron uploads staged ADDON/ADMIN trees here via SSH before your script runs — no rsync needed. Leave empty only if your script uploads itself."
        >
          <Input placeholder="yuvalpi@192.168.0.50" />
        </Form.Item>

        <Form.Item
          label="Manager SSH password (optional)"
          name="managerSshPassword"
          extra="Leave empty to use SSH keys (default ~/.ssh). Set only if the Manager host requires password auth."
        >
          <Input.Password placeholder="Optional" autoComplete="new-password" />
        </Form.Item>

        <Form.Item
          label="Public URL (Stremio)"
          name="publicUrl"
          rules={[
            { required: true, message: "Public URL is required" },
            {
              validator: async (_, v: string) => {
                if (!v || !isHttpUrl(v)) {
                  throw new Error("Enter a full http(s) URL including path prefix if any");
                }
              },
            },
          ]}
          extra={
            isTranslated
              ? "Used for the Translated Subtitles Stremio manifest and post-install health checks."
              : "Used for Stremio manifest links and post-install health checks."
          }
        >
          <Input placeholder="https://gateway.example/svc-public" />
        </Form.Item>

        <Form.Item
          label="Management URL (private admin)"
          name="managementUrl"
          rules={[
            { required: true, message: "Management URL is required" },
            {
              validator: async (_, v: string) => {
                if (!v || !isHttpUrl(v)) {
                  throw new Error("Enter a full http(s) URL including path prefix if any");
                }
              },
            },
          ]}
          extra="Private app with ENABLE_MANAGEMENT_API=true. Must be reachable from this machine."
        >
          <Input placeholder="https://gateway.example/svc-admin" />
        </Form.Item>

        <Form.Item
          label="Health path (under public URL)"
          name="healthPath"
          rules={[{ required: true, message: "Health path required" }]}
        >
          <Input placeholder="/health" />
        </Form.Item>
      </Form>

      <Alert
        type="info"
        showIcon
        message="Unsupported for custom script (for now)"
        description={
          isTranslated
            ? "Automatic migrate from remote→custom_script and rollback/backups are not supported for Translated Subtitles. Re-install manually if switching types; use your Gateway script for recoveries."
            : "Automatic migrate from remote→custom_script, rollback/backups, and Party server deploy via SSH are not supported. Re-install manually if switching types; use your Gateway script for recoveries."
        }
      />

      <Flex justify="space-between">
        <Button onClick={onBack}>Back</Button>
        <Button type="primary" onClick={() => void handleNext()}>
          Next
        </Button>
      </Flex>
    </Flex>
  );
}

export default AccessUrlsStep;
