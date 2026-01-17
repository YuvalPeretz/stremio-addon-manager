/**
 * Addon Management Page
 * Manage all installed addons with table view and actions
 */

import { useEffect, useState } from "react";
import { useAtom } from "jotai";
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  Typography,
  Modal,
  message,
  Popconfirm,
  Tooltip,
  Flex,
  Input,
} from "antd";
import {
  FiPlay,
  FiPause,
  FiRotateCw,
  FiTrash2,
  FiRefreshCw,
  FiPlus,
  FiEye,
  FiCheck,
  FiX,
} from "react-icons/fi";
import type { ColumnsType } from "antd/es/table";
import { addonListAtom, addonLoadingAtom, selectedAddonIdAtom, defaultAddonAtom } from "../../atoms/addonAtoms";
import type { AddonMetadata } from "@stremio-addon-manager/core";
import styles from "./AddonManagement.module.scss";

const { Title, Text } = Typography;
const { Search } = Input;

interface AddonWithStatus extends AddonMetadata {
  status?: string;
  serviceEnabled?: boolean;
}

function AddonManagement() {
  const [addonList, setAddonList] = useAtom(addonListAtom);
  const [loading, setLoading] = useAtom(addonLoadingAtom);
  const [selectedAddonId, setSelectedAddonId] = useAtom(selectedAddonIdAtom);
  const [defaultAddon, setDefaultAddon] = useAtom(defaultAddonAtom);
  const [addonsWithStatus, setAddonsWithStatus] = useState<AddonWithStatus[]>([]);
  const [statusLoading, setStatusLoading] = useState<Record<string, boolean>>({});
  const [searchText, setSearchText] = useState("");

  useEffect(() => {
    loadAddons();
    loadDefaultAddon();
  }, []);

  useEffect(() => {
    // Load status for all addons
    loadAllStatuses();
  }, [addonList]);

  async function loadAddons() {
    setLoading(true);
    try {
      const result = await window.electron.addon.list();
      if (result.success && result.data) {
        setAddonList(result.data as AddonMetadata[]);
      }
    } catch (error) {
      message.error("Failed to load addons");
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  async function loadDefaultAddon() {
    try {
      const result = await window.electron.addon.getDefault();
      if (result.success && result.data) {
        setDefaultAddon(result.data as AddonMetadata | null);
      }
    } catch (error) {
      console.error("Failed to load default addon", error);
    }
  }

  async function loadAllStatuses() {
    const statuses: Record<string, { status: string; enabled: boolean }> = {};
    const loadingStates: Record<string, boolean> = {};

    for (const addon of addonList) {
      loadingStates[addon.id] = true;
      setStatusLoading({ ...loadingStates });

      try {
        const result = await window.electron.service.status(undefined, addon.id);
        if (result.success && result.data) {
          const serviceInfo = result.data as any;
          statuses[addon.id] = {
            status: serviceInfo.status || "unknown",
            enabled: serviceInfo.enabled || false,
          };
        }
      } catch (error) {
        statuses[addon.id] = { status: "unknown", enabled: false };
      }

      loadingStates[addon.id] = false;
      setStatusLoading({ ...loadingStates });
    }

    // Merge status into addon list
    const addonsWithStatusData = addonList.map((addon) => ({
      ...addon,
      status: statuses[addon.id]?.status || "unknown",
      serviceEnabled: statuses[addon.id]?.enabled || false,
    }));

    setAddonsWithStatus(addonsWithStatusData);
  }

  async function handleServiceAction(addonId: string, action: "start" | "stop" | "restart") {
    setStatusLoading({ ...statusLoading, [addonId]: true });
    try {
      const result = await window.electron.service[action](undefined, addonId);
      if (result.success) {
        message.success(`Service ${action}ed successfully`);
        await loadAllStatuses();
      } else {
        message.error(result.error || `Failed to ${action} service`);
      }
    } catch (error) {
      message.error(`Failed to ${action} service`);
      console.error(error);
    } finally {
      setStatusLoading({ ...statusLoading, [addonId]: false });
    }
  }

  async function handleSwitchAddon(addonId: string) {
    try {
      const result = await window.electron.addon.setDefault(addonId);
      if (result.success) {
        setSelectedAddonId(addonId);
        await loadDefaultAddon();
        message.success("Default addon switched successfully");
      } else {
        message.error(result.error || "Failed to switch addon");
      }
    } catch (error) {
      message.error("Failed to switch addon");
      console.error(error);
    }
  }

  async function handleDeleteAddon(addonId: string) {
    try {
      const result = await window.electron.addon.delete(addonId);
      if (result.success) {
        message.success("Addon deleted successfully");
        await loadAddons();
        // If deleted addon was selected, clear selection
        if (selectedAddonId === addonId) {
          setSelectedAddonId(null);
        }
      } else {
        message.error(result.error || "Failed to delete addon");
      }
    } catch (error) {
      message.error("Failed to delete addon");
      console.error(error);
    }
  }

  function getStatusColor(status: string) {
    switch (status?.toLowerCase()) {
      case "active":
      case "running":
        return "success";
      case "inactive":
      case "stopped":
        return "default";
      case "failed":
        return "error";
      default:
        return "default";
    }
  }

  function getStatusText(status: string) {
    switch (status?.toLowerCase()) {
      case "active":
      case "running":
        return "Running";
      case "inactive":
      case "stopped":
        return "Stopped";
      case "failed":
        return "Failed";
      default:
        return "Unknown";
    }
  }

  const filteredAddons = addonsWithStatus.filter(
    (addon) =>
      addon.name.toLowerCase().includes(searchText.toLowerCase()) ||
      addon.id.toLowerCase().includes(searchText.toLowerCase()) ||
      addon.domain.toLowerCase().includes(searchText.toLowerCase())
  );

  const columns: ColumnsType<AddonWithStatus> = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      render: (text: string, record: AddonWithStatus) => (
        <Space>
          <Text strong>{text}</Text>
          {defaultAddon?.id === record.id && <Tag color="blue">Default</Tag>}
        </Space>
      ),
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      title: "ID",
      dataIndex: "id",
      key: "id",
      render: (text: string) => <Text code style={{ fontSize: "12px" }}>{text}</Text>,
      sorter: (a, b) => a.id.localeCompare(b.id),
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      render: (status: string, record: AddonWithStatus) => (
        <Space>
          <Tag color={getStatusColor(status)}>{getStatusText(status)}</Tag>
          {record.serviceEnabled && <Tag color="success">Auto-start</Tag>}
        </Space>
      ),
      filters: [
        { text: "Running", value: "active" },
        { text: "Stopped", value: "inactive" },
        { text: "Failed", value: "failed" },
      ],
      onFilter: (value, record) => record.status?.toLowerCase() === (value as string).toLowerCase(),
    },
    {
      title: "Port",
      dataIndex: "port",
      key: "port",
      sorter: (a, b) => a.port - b.port,
    },
    {
      title: "Domain",
      dataIndex: "domain",
      key: "domain",
      render: (text: string) => <Text copyable>{text}</Text>,
    },
    {
      title: "URL",
      key: "url",
      render: (_: unknown, record: AddonWithStatus) => {
        const protocol = "https";
        const url = `${protocol}://${record.domain}/${record.id}/manifest.json`;
        return (
          <Tooltip title={url}>
            <Text copyable style={{ maxWidth: 200, display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>
              {url}
            </Text>
          </Tooltip>
        );
      },
    },
    {
      title: "Actions",
      key: "actions",
      width: 300,
      render: (_: unknown, record: AddonWithStatus) => (
        <Space size="small">
          <Tooltip title="View Details">
            <Button
              icon={<FiEye />}
              size="small"
              onClick={() => {
                setSelectedAddonId(record.id);
                message.info(`Switched to addon: ${record.name}`);
              }}
            >
              View
            </Button>
          </Tooltip>
          {defaultAddon?.id !== record.id && (
            <Tooltip title="Set as Default">
              <Button
                icon={<FiCheck />}
                size="small"
                onClick={() => handleSwitchAddon(record.id)}
              >
                Switch
              </Button>
            </Tooltip>
          )}
          {record.status?.toLowerCase() === "active" || record.status?.toLowerCase() === "running" ? (
            <Tooltip title="Stop Service">
              <Button
                icon={<FiPause />}
                size="small"
                danger
                loading={statusLoading[record.id]}
                onClick={() => handleServiceAction(record.id, "stop")}
              >
                Stop
              </Button>
            </Tooltip>
          ) : (
            <Tooltip title="Start Service">
              <Button
                icon={<FiPlay />}
                size="small"
                type="primary"
                loading={statusLoading[record.id]}
                onClick={() => handleServiceAction(record.id, "start")}
              >
                Start
              </Button>
            </Tooltip>
          )}
          <Tooltip title="Restart Service">
            <Button
              icon={<FiRotateCw />}
              size="small"
              loading={statusLoading[record.id]}
              onClick={() => handleServiceAction(record.id, "restart")}
            >
              Restart
            </Button>
          </Tooltip>
          <Popconfirm
            title="Delete Addon"
            description={`Are you sure you want to delete "${record.name}"? This will remove it from the registry but not uninstall it.`}
            onConfirm={() => handleDeleteAddon(record.id)}
            okText="Yes"
            cancelText="No"
            okButtonProps={{ danger: true }}
          >
            <Tooltip title="Delete Addon">
              <Button icon={<FiTrash2 />} size="small" danger>
                Delete
              </Button>
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Flex vertical gap={24} className={styles.addonManagement}>
      <Flex justify="space-between" align="center">
        <Title level={2}>Addon Management</Title>
        <Space>
          <Button icon={<FiRefreshCw />} onClick={loadAddons} loading={loading}>
            Refresh
          </Button>
        </Space>
      </Flex>

      <Card>
        <Flex vertical gap={16}>
          <Search
            placeholder="Search addons by name, ID, or domain..."
            allowClear
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ maxWidth: 400 }}
          />
          <Table
            columns={columns}
            dataSource={filteredAddons}
            rowKey="id"
            loading={loading}
            pagination={{
              pageSize: 10,
              showSizeChanger: true,
              showTotal: (total) => `Total ${total} addons`,
            }}
            scroll={{ x: 1200 }}
          />
        </Flex>
      </Card>
    </Flex>
  );
}

export default AddonManagement;
