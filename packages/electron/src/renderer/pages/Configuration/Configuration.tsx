/**
 * Configuration Page
 * Manage addon configuration with forms and validation
 */

import { useState, useEffect } from "react";
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
  message,
  Modal,
  Space,
  Divider,
} from "antd";
import { FiSave, FiRotateCw, FiDownload, FiUpload } from "react-icons/fi";
import { configAtom } from "../../atoms/configAtoms";
import { selectedAddonIdAtom } from "../../atoms/addonAtoms";
import EnvironmentVariables from "../EnvironmentVariables/EnvironmentVariables";
import styles from "./Configuration.module.scss";

const { Title, Text } = Typography;

function Configuration() {
  const [config, setConfig] = useAtom(configAtom);
  const [selectedAddonId] = useAtom(selectedAddonIdAtom);
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    loadConfiguration();
  }, [selectedAddonId]);

  async function loadConfiguration() {
    setLoading(true);
    const result = await window.electron.config.load(selectedAddonId || undefined);
    setLoading(false);

    if (result.success) {
      setConfig(result.data as any);
      form.setFieldsValue(result.data);
      setHasChanges(false);
    } else {
      message.error("Failed to load configuration");
    }
  }

  async function handleSave() {
    try {
      await form.validateFields();
      const values = form.getFieldsValue();

      setLoading(true);
      const result = await window.electron.config.save(values, selectedAddonId || undefined);
      setLoading(false);

      if (result.success) {
        setConfig(values);
        setHasChanges(false);
        message.success("Configuration saved successfully");
      } else {
        message.error(result.error || "Failed to save configuration");
      }
    } catch (error) {
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

  const tabItems = [
    {
      key: "addon",
      label: "Addon Settings",
      children: (
        <Card>
          <Form.Item label="Addon Name" name={["addon", "name"]} rules={[{ required: true }]}>
            <Input />
          </Form.Item>

          <Form.Item label="Domain" name={["addon", "domain"]} rules={[{ required: true }]}>
            <Input />
          </Form.Item>

          <Form.Item label="Password" name={["addon", "password"]} rules={[{ required: true, min: 8 }]}>
            <Input.Password />
          </Form.Item>

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
          <Card title="Security" size="small">
            <Form.Item label="Firewall (UFW)" name={["features", "firewall"]} valuePropName="checked">
              <Switch />
            </Form.Item>

            <Form.Item label="fail2ban" name={["features", "fail2ban"]} valuePropName="checked">
              <Switch />
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
              <Switch />
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
              <Switch />
            </Form.Item>

            <Form.Item label="Auto-start on Boot" name={["features", "autoStart"]} valuePropName="checked">
              <Switch />
            </Form.Item>

            <Form.Item label="SSL/HTTPS" name={["features", "ssl"]} valuePropName="checked">
              <Switch disabled />
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
          <Form.Item label="Real-Debrid Token" name={["secrets", "realDebridToken"]} extra="Your Real-Debrid API token">
            <Input.Password placeholder="Enter Real-Debrid token" />
          </Form.Item>

          <Form.Item label="DuckDNS Token" name={["secrets", "duckdnsToken"]} extra="Your DuckDNS token (optional)">
            <Input.Password placeholder="Enter DuckDNS token" />
          </Form.Item>
        </Card>
      ),
    },
    {
      key: "paths",
      label: "Paths",
      children: (
        <Card>
          <Form.Item label="Addon Directory" name={["paths", "addonDirectory"]}>
            <Input disabled />
          </Form.Item>

          <Form.Item label="Nginx Config" name={["paths", "nginxConfig"]}>
            <Input disabled />
          </Form.Item>

          <Form.Item label="Service File" name={["paths", "serviceFile"]}>
            <Input disabled />
          </Form.Item>

          <Form.Item label="Logs Directory" name={["paths", "logs"]}>
            <Input disabled />
          </Form.Item>

          <Form.Item label="Backups Directory" name={["paths", "backups"]}>
            <Input disabled />
          </Form.Item>

          <Text type="secondary">System paths are read-only</Text>
        </Card>
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
        <Tabs items={tabItems} />
      </Form>
    </Flex>
  );
}

export default Configuration;
