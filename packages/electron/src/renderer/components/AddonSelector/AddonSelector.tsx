/**
 * Addon Selector Component
 * Dropdown for selecting and managing addons
 */

import { useEffect, useState } from "react";
import { useAtom } from "jotai";
import {
  Select,
  Button,
  Space,
  Typography,
  Modal,
  Form,
  InputNumber,
  Input,
  message,
  Radio,
  Alert,
} from "antd";
import { FiPlus, FiRefreshCw } from "react-icons/fi";
import type { AddonMetadata } from "@stremio-addon-manager/core";
import { normalizeAddonProduct, productLabel } from "@stremio-addon-manager/core/browser";
import { selectedAddonIdAtom, addonListAtom, defaultAddonAtom, addonLoadingAtom } from "../../atoms/addonAtoms";
import { installationResultAtom } from "../../atoms/installationAtoms";
import styles from "./AddonSelector.module.scss";

const { Option } = Select;
const { Text } = Typography;

type CreateMode = "classic" | "custom_script";

interface CreateAddonFormValues {
  mode: CreateMode;
  name: string;
  port?: number;
  domain?: string;
  publicUrl?: string;
  managementUrl?: string;
}

function AddonSelector() {
  const [selectedAddonId, setSelectedAddonId] = useAtom(selectedAddonIdAtom);
  const [addonList, setAddonList] = useAtom(addonListAtom);
  const [defaultAddon, setDefaultAddon] = useAtom(defaultAddonAtom);
  const [loading, setLoading] = useAtom(addonLoadingAtom);
  const [installationResult] = useAtom(installationResultAtom);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<CreateAddonFormValues>();
  const createMode = Form.useWatch("mode", form) as CreateMode | undefined;

  useEffect(() => {
    loadAddons();
    loadDefaultAddon();
  }, []);

  useEffect(() => {
    // If no addon selected but we have addons, select default or first
    if (!selectedAddonId && addonList.length > 0) {
      const defaultId = defaultAddon?.id || addonList[0].id;
      setSelectedAddonId(defaultId);
    }
  }, [addonList, defaultAddon, selectedAddonId, setSelectedAddonId]);

  // Refresh addon list when installation completes successfully
  useEffect(() => {
    if (installationResult?.success) {
      loadAddons();
      loadDefaultAddon();
    }
  }, [installationResult]);

  async function loadAddons() {
    setLoading(true);
    try {
      const result = await window.electron.addon.list();
      if (result.success && result.data) {
        setAddonList(result.data as AddonMetadata[]);
      }
    } catch (error) {
      console.error("Failed to load addons", error);
    } finally {
      setLoading(false);
    }
  }

  async function loadDefaultAddon() {
    try {
      const result = await window.electron.addon.getDefault();
      if (result.success && result.data) {
        setDefaultAddon(result.data as any);
      }
    } catch (error) {
      console.error("Failed to load default addon", error);
    }
  }

  async function handleAddonChange(addonId: string) {
    setSelectedAddonId(addonId);
    // Optionally set as default
    await window.electron.addon.setDefault(addonId);
    await loadDefaultAddon();
  }

  function openCreateModal() {
    form.resetFields();
    form.setFieldsValue({ mode: "classic", port: 7000 });
    setCreateModalVisible(true);
  }

  async function handleCreateAddon(values: CreateAddonFormValues) {
    setCreating(true);
    try {
      const result =
        values.mode === "custom_script"
          ? await window.electron.addon.create({
              name: values.name,
              type: "custom_script",
              publicUrl: values.publicUrl,
              managementUrl: values.managementUrl?.trim() || undefined,
            })
          : await window.electron.addon.create({
              name: values.name,
              type: "classic",
              port: values.port,
              domain: values.domain,
            });

      if (result.success) {
        message.success(`Addon '${values.name}' created successfully`);
        setCreateModalVisible(false);
        form.resetFields();
        await loadAddons();
        if (result.data) {
          const newAddon = result.data as { id: string };
          setSelectedAddonId(newAddon.id);
        }
      } else {
        message.error(result.error || "Failed to create addon");
      }
    } catch (error) {
      message.error("Failed to create addon");
      console.error(error);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className={styles.addonSelector}>
      <Space>
        <Select
          value={selectedAddonId || undefined}
          onChange={handleAddonChange}
          loading={loading}
          placeholder="Select Addon"
          style={{ minWidth: 200 }}
          dropdownRender={(menu) => (
            <>
              {menu}
              <div style={{ padding: "8px", borderTop: "1px solid #f0f0f0" }}>
                <Button
                  type="link"
                  icon={<FiPlus />}
                  onClick={openCreateModal}
                  style={{ width: "100%" }}
                >
                  Create New Addon
                </Button>
              </div>
            </>
          )}
        >
          {addonList.map((addon) => (
            <Option key={addon.id} value={addon.id}>
              <Space>
                <Text>{addon.name}</Text>
                {defaultAddon?.id === addon.id && <Text type="secondary">(default)</Text>}
                <Text type="secondary" style={{ fontSize: "12px" }}>
                  {productLabel(normalizeAddonProduct(addon.product))}
                </Text>
                <Text type="secondary" style={{ fontSize: "12px" }}>
                  {addon.domain?.includes("/") ? addon.domain : `Port: ${addon.port}`}
                </Text>
              </Space>
            </Option>
          ))}
        </Select>
        <Button icon={<FiRefreshCw />} onClick={loadAddons} loading={loading} />
      </Space>

      <Modal
        title="Create New Addon"
        open={createModalVisible}
        onCancel={() => {
          setCreateModalVisible(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        okText="Create"
        confirmLoading={creating}
        destroyOnClose
        width={520}
      >
        <Form
          form={form}
          onFinish={handleCreateAddon}
          layout="vertical"
          initialValues={{ mode: "classic", port: 7000 }}
        >
          <Form.Item name="mode" label="Addon type" rules={[{ required: true }]}>
            <Radio.Group
              optionType="button"
              buttonStyle="solid"
              options={[
                { label: "Host / Port", value: "classic" },
                { label: "Custom / Gateway", value: "custom_script" },
              ]}
            />
          </Form.Item>

          <Form.Item
            name="name"
            label="Addon Name"
            rules={[{ required: true, message: "Addon name is required" }]}
          >
            <Input placeholder="My Private Addon" />
          </Form.Item>

          {createMode === "custom_script" ? (
            <>
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="Register an existing Gateway dual-app install"
                description="Use the full public base URL including any /svc-…/ path prefix. Port is not required — registry metadata defaults to 8080."
              />
              <Form.Item
                name="publicUrl"
                label="Public URL"
                rules={[
                  { required: true, message: "Public URL is required" },
                  {
                    validator: async (_, value: string | undefined) => {
                      const trimmed = value?.trim();
                      if (!trimmed) return;
                      try {
                        void new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
                      } catch {
                        throw new Error("Enter a valid URL (e.g. https://host/svc-xxx/)");
                      }
                    },
                  },
                ]}
                extra="Stremio-facing base, e.g. https://gateway.example/svc-abc123/"
              >
                <Input placeholder="https://host/svc-xxx/" />
              </Form.Item>
              <Form.Item
                name="managementUrl"
                label="Management URL"
                rules={[
                  {
                    validator: async (_, value: string | undefined) => {
                      const trimmed = value?.trim();
                      if (!trimmed) return;
                      try {
                        void new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
                      } catch {
                        throw new Error("Enter a valid URL");
                      }
                    },
                  },
                ]}
                extra="Optional but recommended — private admin base. Defaults to Public URL if omitted."
              >
                <Input placeholder="https://lan-host/svc-admin/" />
              </Form.Item>
            </>
          ) : (
            <>
              <Form.Item
                name="port"
                label="Port"
                rules={[
                  { required: true, message: "Port is required" },
                  { type: "number", min: 1, max: 65535 },
                ]}
              >
                <InputNumber placeholder="7000" style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item
                name="domain"
                label="Domain"
                rules={[{ required: true, message: "Domain is required" }]}
              >
                <Input placeholder="yourdomain.duckdns.org" />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </div>
  );
}

export default AddonSelector;
