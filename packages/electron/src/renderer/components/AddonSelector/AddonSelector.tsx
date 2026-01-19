/**
 * Addon Selector Component
 * Dropdown for selecting and managing addons
 */

import { useEffect, useState } from "react";
import { useAtom } from "jotai";
import { Select, Button, Space, Typography, Modal, Form, InputNumber, Input, message } from "antd";
import { FiPlus, FiRefreshCw } from "react-icons/fi";
import { selectedAddonIdAtom, addonListAtom, defaultAddonAtom, addonLoadingAtom } from "../../atoms/addonAtoms";
import { installationResultAtom } from "../../atoms/installationAtoms";
import styles from "./AddonSelector.module.scss";

const { Option } = Select;
const { Text } = Typography;

function AddonSelector() {
  const [selectedAddonId, setSelectedAddonId] = useAtom(selectedAddonIdAtom);
  const [addonList, setAddonList] = useAtom(addonListAtom);
  const [defaultAddon, setDefaultAddon] = useAtom(defaultAddonAtom);
  const [loading, setLoading] = useAtom(addonLoadingAtom);
  const [installationResult] = useAtom(installationResultAtom);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [form] = Form.useForm();

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
        setAddonList(result.data as any[]);
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

  async function handleCreateAddon(values: { name: string; port: number; domain: string }) {
    try {
      const result = await window.electron.addon.create(values.name, values.port, values.domain);
      if (result.success) {
        message.success(`Addon '${values.name}' created successfully`);
        setCreateModalVisible(false);
        form.resetFields();
        await loadAddons();
        if (result.data) {
          const newAddon = result.data as any;
          setSelectedAddonId(newAddon.id);
        }
      } else {
        message.error(result.error || "Failed to create addon");
      }
    } catch (error) {
      message.error("Failed to create addon");
      console.error(error);
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
                  onClick={() => setCreateModalVisible(true)}
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
                  Port: {addon.port}
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
      >
        <Form form={form} onFinish={handleCreateAddon} layout="vertical">
          <Form.Item
            name="name"
            label="Addon Name"
            rules={[{ required: true, message: "Addon name is required" }]}
          >
            <Input placeholder="My Private Addon" />
          </Form.Item>
          <Form.Item
            name="port"
            label="Port"
            rules={[{ required: true, message: "Port is required" }, { type: "number", min: 1, max: 65535 }]}
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
        </Form>
      </Modal>
    </div>
  );
}

export default AddonSelector;
