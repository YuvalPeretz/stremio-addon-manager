/**
 * Environment Variables Page
 * Manage environment variables for addon services
 */

import { useState, useEffect } from "react";
import { useAtom } from "jotai";
import { Flex, Typography, Button, Table, Input, Space, message, Modal, Tag, Tooltip, Popconfirm } from "antd";
import { FiRefreshCw, FiEdit, FiRotateCw, FiSave, FiShuffle } from "react-icons/fi";
import { selectedAddonIdAtom } from "../../atoms/addonAtoms";
import styles from "./EnvironmentVariables.module.scss";

const { Title, Text } = Typography;
const { Search } = Input;

interface EnvVarMetadata {
  description: string;
  default?: string | number;
  type: "string" | "number" | "boolean";
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  required: boolean;
  sensitive: boolean;
  generateable: boolean;
  source: string;
}

interface EnvVarRow {
  key: string;
  value: string;
  source: "default" | "config" | "override";
  metadata?: EnvVarMetadata;
  default?: string;
}

function EnvironmentVariables() {
  const [selectedAddonId] = useAtom(selectedAddonIdAtom);
  const [loading, setLoading] = useState(false);
  const [envVars, setEnvVars] = useState<Record<string, string>>({});
  const [metadata, setMetadata] = useState<Record<string, EnvVarMetadata>>({});
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [searchText, setSearchText] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [config, setConfig] = useState<any>(null);

  useEffect(() => {
    // Load config first, then metadata and env vars (which may depend on config for SSH)
    async function initialize() {
      await loadConfig();
      await loadMetadata();
      await loadEnvironmentVariables();
    }
    initialize();
  }, [selectedAddonId]);

  async function loadConfig() {
    try {
      const result = await window.electron.config.load(selectedAddonId || undefined);
      if (result.success) {
        setConfig(result.data);
      }
    } catch (error) {
      console.error("Failed to load config", error);
    }
  }

  async function loadMetadata() {
    try {
      const result = await window.electron.env.getMetadata();
      if (result.success && result.data) {
        setMetadata(result.data.metadata as Record<string, EnvVarMetadata>);
        setDefaults(result.data.defaults);
      }
    } catch (error) {
      console.error("Failed to load metadata", error);
    }
  }

  // Get SSH config from addon config if available
  function getSSHConfig(): any {
    if (!config) {
      return undefined;
    }
    const target = config?.installation?.target;
    if (target && (target.host || target.privateKeyPath)) {
      // Construct SSH config from target config
      return {
        host: target.host,
        port: target.port || 22,
        username: target.username,
        password: target.password,
        privateKeyPath: target.privateKeyPath,
      };
    }
    return undefined;
  }

  async function loadEnvironmentVariables() {
    setLoading(true);
    try {
      // Ensure config is loaded before getting SSH config
      if (!config && selectedAddonId) {
        await loadConfig();
      }
      const ssh = getSSHConfig();
      const result = await window.electron.env.list(ssh, selectedAddonId || undefined);
      if (result.success && result.data) {
        setEnvVars(result.data);
      } else {
        message.error(result.error || "Failed to load environment variables");
      }
    } catch (error) {
      message.error("Failed to load environment variables");
    } finally {
      setLoading(false);
    }
  }

  function maskValue(key: string, value: string): string {
    const meta = metadata[key];
    if (meta?.sensitive && value) {
      return "•".repeat(Math.min(value.length, 20));
    }
    return value;
  }

  function getSourceColor(source: "default" | "config" | "override"): string {
    switch (source) {
      case "override":
        return "orange";
      case "config":
        return "blue";
      default:
        return "default";
    }
  }

  function getSourceLabel(source: "default" | "config" | "override"): string {
    switch (source) {
      case "override":
        return "Override";
      case "config":
        return "Config";
      default:
        return "Default";
    }
  }

  async function handleSet(key: string, value: string) {
    try {
      const ssh = getSSHConfig();
      const result = await window.electron.env.set(key, value, ssh, selectedAddonId || undefined);
      if (result.success) {
        message.success(`Environment variable '${key}' updated`);
        await loadEnvironmentVariables();
        await loadConfig();
        setEditingKey(null);
        setEditValue("");
      } else {
        message.error(result.error || "Failed to update environment variable");
      }
    } catch (error) {
      message.error("Failed to update environment variable");
    }
  }

  async function handleUnset(key: string) {
    try {
      const ssh = getSSHConfig();
      const result = await window.electron.env.unset(key, ssh, selectedAddonId || undefined);
      if (result.success) {
        message.success(`Environment variable '${key}' reset to default`);
        await loadEnvironmentVariables();
        await loadConfig();
      } else {
        message.error(result.error || "Failed to reset environment variable");
      }
    } catch (error) {
      message.error("Failed to reset environment variable");
    }
  }

  async function handleResetAll() {
    Modal.confirm({
      title: "Reset All Environment Variables",
      content: "Are you sure you want to reset all environment variables to their default values?",
      okText: "Reset All",
      okType: "danger",
      onOk: async () => {
        try {
          const ssh = getSSHConfig();
          const result = await window.electron.env.reset(ssh, selectedAddonId || undefined);
          if (result.success) {
            message.success("All environment variables reset to defaults");
            await loadEnvironmentVariables();
            await loadConfig();
          } else {
            message.error(result.error || "Failed to reset environment variables");
          }
        } catch (error) {
          message.error("Failed to reset environment variables");
        }
      },
    });
  }

  async function handleSync(restartService: boolean = false) {
    try {
      const ssh = getSSHConfig();
      const result = await window.electron.env.sync(ssh, selectedAddonId || undefined, restartService);
      if (result.success) {
        if (result.data?.updated) {
          message.success("Service file synced successfully");
          if (result.data.changes && result.data.changes.length > 0) {
            Modal.info({
              title: "Changes Applied",
              content: (
                <ul>
                  {result.data.changes.map((change, idx) => (
                    <li key={idx}>{change}</li>
                  ))}
                </ul>
              ),
            });
          }
        } else {
          message.info("Service file is already up to date");
        }
        await loadEnvironmentVariables();
        await loadConfig();
      } else {
        message.error(result.error || "Failed to sync service file");
      }
    } catch (error) {
      message.error("Failed to sync service file");
    }
  }

  async function handleGenerate(key: string) {
    try {
      const ssh = getSSHConfig();
      const result = await window.electron.env.generate(key, ssh, selectedAddonId || undefined);
      if (result.success && result.data) {
        message.success(`Generated new value for '${key}'`);
        await loadEnvironmentVariables();
        await loadConfig();
      } else {
        message.error(result.error || "Failed to generate value");
      }
    } catch (error) {
      message.error("Failed to generate value");
    }
  }

  function startEdit(key: string) {
    setEditingKey(key);
    setEditValue(envVars[key] || "");
  }

  function cancelEdit() {
    setEditingKey(null);
    setEditValue("");
  }

  function saveEdit() {
    if (editingKey) {
      handleSet(editingKey, editValue);
    }
  }

  // Prepare table data
  const tableData: EnvVarRow[] = Object.keys(metadata)
    .filter((key) => !searchText || key.toLowerCase().includes(searchText.toLowerCase()))
    .map((key) => {
      const value = envVars[key] || "";
      const meta = metadata[key];
      const defaultValue = defaults[key] || "";

      // Determine source
      let source: "default" | "config" | "override" = "default";
      if (config?.addon?.environmentVariables?.[key] !== undefined && config.addon.environmentVariables[key] !== null) {
        source = "override";
      } else if (value && value !== defaultValue) {
        source = "config";
      }

      return {
        key,
        value,
        source,
        metadata: meta,
        default: defaultValue,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  // Helper function to build tooltip content
  function buildTooltipContent(record: EnvVarRow): string {
    if (!record.metadata) return record.key;

    const parts: string[] = [record.metadata.description];

    // Add type information
    parts.push(`\nType: ${record.metadata.type}`);

    // Add range information for numbers
    if (record.metadata.type === "number") {
      if (record.metadata.min !== undefined && record.metadata.max !== undefined) {
        parts.push(`Range: ${record.metadata.min}-${record.metadata.max}`);
      } else if (record.metadata.min !== undefined) {
        parts.push(`Min: ${record.metadata.min}`);
      } else if (record.metadata.max !== undefined) {
        parts.push(`Max: ${record.metadata.max}`);
      }
    }

    // Add length information for strings
    if (record.metadata.type === "string") {
      if (record.metadata.minLength !== undefined && record.metadata.maxLength !== undefined) {
        parts.push(`Length: ${record.metadata.minLength}-${record.metadata.maxLength} characters`);
      } else if (record.metadata.minLength !== undefined) {
        parts.push(`Min length: ${record.metadata.minLength} characters`);
      } else if (record.metadata.maxLength !== undefined) {
        parts.push(`Max length: ${record.metadata.maxLength} characters`);
      }
    }

    // Add default value
    if (record.metadata.default !== undefined) {
      parts.push(`Default: ${record.metadata.default}`);
    }

    // Add required status
    parts.push(`Required: ${record.metadata.required ? "Yes" : "No"}`);

    // Add special flags
    const flags: string[] = [];
    if (record.metadata.sensitive) flags.push("Sensitive");
    if (record.metadata.generateable) flags.push("Generateable");
    if (flags.length > 0) {
      parts.push(`\nFlags: ${flags.join(", ")}`);
    }

    // Add source information
    parts.push(`\nSource: ${record.metadata.source}`);

    return parts.join("\n");
  }

  const columns = [
    {
      title: "Variable",
      dataIndex: "key",
      key: "key",
      width: 200,
      render: (key: string, record: EnvVarRow) => (
        <Tooltip title={buildTooltipContent(record)} placement="right">
          <Flex vertical gap={4}>
            <Flex align="center" gap={8}>
              <Text strong>{key}</Text>
              {record.metadata?.required && (
                <Tag color="red" size="small">
                  Required
                </Tag>
              )}
              {record.metadata?.sensitive && (
                <Tag color="orange" size="small">
                  Sensitive
                </Tag>
              )}
              {record.metadata?.generateable && (
                <Tag color="blue" size="small">
                  Generateable
                </Tag>
              )}
            </Flex>
            {record.metadata && (
              <Text type="secondary" style={{ fontSize: "12px" }}>
                {record.metadata.description}
                {record.metadata.type === "number" &&
                  record.metadata.min !== undefined &&
                  record.metadata.max !== undefined && (
                    <span>
                      {" "}
                      ({record.metadata.min}-{record.metadata.max})
                    </span>
                  )}
                {record.metadata.type === "string" && record.metadata.minLength !== undefined && (
                  <span> (min {record.metadata.minLength} chars)</span>
                )}
              </Text>
            )}
          </Flex>
        </Tooltip>
      ),
    },
    {
      title: "Value",
      dataIndex: "value",
      key: "value",
      width: 300,
      render: (value: string, record: EnvVarRow) => {
        if (editingKey === record.key) {
          const placeholder = record.metadata?.default
            ? `Default: ${record.metadata.default}${
                record.metadata.type === "number" &&
                record.metadata.min !== undefined &&
                record.metadata.max !== undefined
                  ? ` (range: ${record.metadata.min}-${record.metadata.max})`
                  : ""
              }`
            : record.metadata?.type === "number" &&
              record.metadata.min !== undefined &&
              record.metadata.max !== undefined
            ? `Range: ${record.metadata.min}-${record.metadata.max}`
            : "";

          return (
            <Tooltip title={record.metadata ? buildTooltipContent(record) : ""}>
              <Input
                type={record.metadata?.sensitive ? "password" : record.metadata?.type === "number" ? "number" : "text"}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onPressEnter={saveEdit}
                placeholder={placeholder}
                autoFocus
              />
            </Tooltip>
          );
        }
        // Show empty string as "(empty)" instead of "(not set)" to distinguish from undefined
        const displayValue = value === "" ? "(empty)" : (value || (record.default ? `(default: ${record.default})` : "(not set)"));
        const maskedValue = record.metadata?.sensitive && value ? maskValue(record.key, value) : displayValue;

        const tooltipContent = record.metadata
          ? `Current value: ${maskedValue}\n${record.metadata.description}${
              record.metadata.type === "number" &&
              record.metadata.min !== undefined &&
              record.metadata.max !== undefined
                ? `\nValid range: ${record.metadata.min}-${record.metadata.max}`
                : ""
            }`
          : maskedValue;

        return (
          <Tooltip title={tooltipContent}>
            <Text code style={{ cursor: "help" }}>
              {maskedValue}
            </Text>
          </Tooltip>
        );
      },
    },
    {
      title: "Source",
      dataIndex: "source",
      key: "source",
      width: 100,
      render: (source: "default" | "config" | "override") => (
        <Tag color={getSourceColor(source)}>{getSourceLabel(source)}</Tag>
      ),
    },
    {
      title: "Default",
      dataIndex: "default",
      key: "default",
      width: 150,
      render: (defaultValue: string) =>
        defaultValue ? <Text code>{defaultValue}</Text> : <Text type="secondary">—</Text>,
    },
    {
      title: "Actions",
      key: "actions",
      width: 250,
      render: (_: unknown, record: EnvVarRow) => (
        <Space size="small">
          {editingKey === record.key ? (
            <>
              <Button size="small" type="primary" icon={<FiSave />} onClick={saveEdit}>
                Save
              </Button>
              <Button size="small" onClick={cancelEdit}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Tooltip title="Edit">
                <Button size="small" icon={<FiEdit />} onClick={() => startEdit(record.key)} />
              </Tooltip>
              {record.metadata?.generateable && (
                <Tooltip title="Generate new value">
                  <Button size="small" icon={<FiShuffle />} onClick={() => handleGenerate(record.key)} />
                </Tooltip>
              )}
              <Popconfirm
                title="Reset to default?"
                description={`Reset '${record.key}' to its default value?`}
                onConfirm={() => handleUnset(record.key)}
                okText="Reset"
                okType="danger"
              >
                <Tooltip title="Reset to default">
                  <Button size="small" icon={<FiRotateCw />} danger />
                </Tooltip>
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className={styles.container}>
      <Flex justify="space-between" align="center" style={{ marginBottom: 16 }}>
        <Title level={5} style={{ margin: 0 }}>
          Environment Variables {selectedAddonId && `(${selectedAddonId})`}
        </Title>
        <Space>
          <Button icon={<FiRefreshCw />} onClick={loadEnvironmentVariables} loading={loading}>
            Refresh
          </Button>
          <Popconfirm
            title="Reset all to defaults?"
            description="This will reset all environment variables to their default values."
            onConfirm={handleResetAll}
            okText="Reset All"
            okType="danger"
          >
            <Button icon={<FiRotateCw />} danger>
              Reset All
            </Button>
          </Popconfirm>
          <Button type="primary" icon={<FiSave />} onClick={() => handleSync(false)}>
            Sync with Config
          </Button>
          <Popconfirm
            title="Sync and restart service?"
            description="This will sync the service file and restart the service to apply changes."
            onConfirm={() => handleSync(true)}
            okText="Sync & Restart"
          >
            <Button type="primary" icon={<FiSave />}>
              Sync & Restart
            </Button>
          </Popconfirm>
        </Space>
      </Flex>

      <Search
        placeholder="Search environment variables..."
        allowClear
        style={{ marginBottom: 16 }}
        onChange={(e) => setSearchText(e.target.value)}
      />

      <Table
        columns={columns}
        dataSource={tableData}
        rowKey="key"
        loading={loading}
        pagination={{ pageSize: 20 }}
        size="small"
      />
    </div>
  );
}

export default EnvironmentVariables;
