/**
 * Service Control Page
 * Start, stop, restart, and monitor the addon service
 */

import { useState, useEffect } from "react";
import { useAtom } from "jotai";
import {
  Card,
  Flex,
  Typography,
  Button,
  Switch,
  Descriptions,
  Badge,
  Space,
  message,
  Modal,
  Alert,
} from "antd";
import {
  FiPlay,
  FiSquare,
  FiRotateCw,
  FiActivity,
  FiAlertCircle,
  FiCheckCircle,
  FiXCircle,
} from "react-icons/fi";
import type { ServiceInfo, ServiceStatus } from "@stremio-addon-manager/core";
import { serviceStatusAtom } from "../../atoms/serviceAtoms";
import styles from "./ServiceControl.module.scss";

const { Title, Text } = Typography;

function ServiceControl() {
  const [serviceStatus, setServiceStatus] = useAtom(serviceStatusAtom);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [autoStartEnabled, setAutoStartEnabled] = useState(false);
  const [serviceInfo, setServiceInfo] = useState<ServiceInfo | null>(null);

  useEffect(() => {
    loadServiceStatus();
    // Poll service status every 5 seconds
    const interval = setInterval(loadServiceStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  async function loadServiceStatus() {
    setRefreshing(true);
    const result = await window.electron.service.status();
    setRefreshing(false);

    if (result.success && result.data) {
      const data = result.data as ServiceInfo;
      setServiceInfo(data);
      setServiceStatus(data);
      setAutoStartEnabled(data.enabled);
    } else {
      message.error("Failed to load service status");
    }
  }

  async function handleStart() {
    setLoading(true);
    const result = await window.electron.service.start();
    setLoading(false);

    if (result.success) {
      message.success("Service started successfully");
      await loadServiceStatus();
    } else {
      message.error(result.error || "Failed to start service");
    }
  }

  async function handleStop() {
    Modal.confirm({
      title: "Stop Service",
      content: "Are you sure you want to stop the addon service? Users will not be able to stream.",
      okText: "Stop",
      okType: "danger",
      onOk: async () => {
        setLoading(true);
        const result = await window.electron.service.stop();
        setLoading(false);

        if (result.success) {
          message.success("Service stopped successfully");
          await loadServiceStatus();
        } else {
          message.error(result.error || "Failed to stop service");
        }
      },
    });
  }

  async function handleRestart() {
    setLoading(true);
    const result = await window.electron.service.restart();
    setLoading(false);

    if (result.success) {
      message.success("Service restarted successfully");
      await loadServiceStatus();
    } else {
      message.error(result.error || "Failed to restart service");
    }
  }

  async function handleAutoStartToggle(enabled: boolean) {
    setLoading(true);
    const result = enabled
      ? await window.electron.service.enableAutoStart()
      : await window.electron.service.disableAutoStart();
    setLoading(false);

    if (result.success) {
      message.success(`Auto-start ${enabled ? "enabled" : "disabled"} successfully`);
      setAutoStartEnabled(enabled);
      await loadServiceStatus();
    } else {
      message.error(result.error || `Failed to ${enabled ? "enable" : "disable"} auto-start`);
    }
  }

  function getStatusBadge() {
    if (!serviceInfo) {
      return <Badge status="warning" text="Unknown" />;
    }

    switch (serviceInfo.status) {
      case "active":
        return <Badge status="success" text="Active" />;
      case "inactive":
        return <Badge status="default" text="Inactive" />;
      case "failed":
        return <Badge status="error" text="Failed" />;
      default:
        return <Badge status="warning" text="Unknown" />;
    }
  }

  function getStatusIcon() {
    if (!serviceInfo) {
      return <FiActivity className={styles.iconDefault} />;
    }

    switch (serviceInfo.status) {
      case "active":
        return <FiCheckCircle className={styles.iconSuccess} />;
      case "inactive":
        return <FiAlertCircle className={styles.iconWarning} />;
      case "failed":
        return <FiXCircle className={styles.iconError} />;
      default:
        return <FiActivity className={styles.iconDefault} />;
    }
  }

  function getStatusMessage() {
    if (!serviceInfo) {
      return "Service status unknown";
    }

    switch (serviceInfo.status) {
      case "active":
        return "Service is running normally";
      case "inactive":
        return "Service is not running";
      case "failed":
        return "Service has failed. Check logs for details.";
      default:
        return "Service status unknown";
    }
  }

  return (
    <Flex vertical gap={24} className={styles.serviceControl}>
      <Flex justify="space-between" align="center">
        <Title level={2}>Service Control</Title>
        <Button
          icon={<FiRotateCw className={refreshing ? styles.spinning : ""} />}
          onClick={loadServiceStatus}
          disabled={refreshing}
        >
          Refresh
        </Button>
      </Flex>

      {/* Status Overview */}
      <Card>
        <Flex vertical gap={16}>
          <Flex align="center" gap={16}>
            {getStatusIcon()}
            <div>
              <Title level={4} style={{ margin: 0 }}>
                {getStatusBadge()}
              </Title>
              <Text type="secondary">{getStatusMessage()}</Text>
            </div>
          </Flex>

          {serviceInfo && serviceInfo.status === "failed" && (
            <Alert
              type="error"
              message="Service Failed"
              description="The addon service has failed. Try restarting the service or check the logs for more information."
              showIcon
            />
          )}

          {serviceInfo && serviceInfo.status === "inactive" && (
            <Alert
              type="warning"
              message="Service Inactive"
              description="The addon service is not running. Users will not be able to access the addon."
              showIcon
            />
          )}
        </Flex>
      </Card>

      {/* Service Information */}
      <Card title="Service Information">
        <Descriptions column={2} bordered>
          <Descriptions.Item label="Status">{getStatusBadge()}</Descriptions.Item>
          <Descriptions.Item label="Running">
            {serviceInfo && serviceInfo.status === "active" ? "Yes" : "No"}
          </Descriptions.Item>
          <Descriptions.Item label="Auto-start">
            <Flex gap={8} align="center">
              <Switch
                checked={autoStartEnabled}
                onChange={handleAutoStartToggle}
                loading={loading}
                disabled={loading}
              />
              <Text>{autoStartEnabled ? "Enabled" : "Disabled"}</Text>
            </Flex>
          </Descriptions.Item>
          <Descriptions.Item label="Process ID">{serviceInfo?.pid || "N/A"}</Descriptions.Item>
          <Descriptions.Item label="Uptime">{serviceInfo?.uptime || "N/A"}</Descriptions.Item>
          <Descriptions.Item label="Memory Usage">{serviceInfo?.memory || "N/A"}</Descriptions.Item>
          <Descriptions.Item label="CPU Usage" span={2}>{serviceInfo?.cpu || "N/A"}</Descriptions.Item>
        </Descriptions>
      </Card>

      {/* Control Actions */}
      <Card title="Service Actions">
        <Flex gap={16} wrap="wrap">
          <Button
            type="primary"
            icon={<FiPlay />}
            size="large"
            onClick={handleStart}
            loading={loading}
            disabled={loading || !serviceInfo || serviceInfo.status === "active"}
          >
            Start Service
          </Button>
          <Button
            danger
            icon={<FiSquare />}
            size="large"
            onClick={handleStop}
            loading={loading}
            disabled={loading || !serviceInfo || serviceInfo.status === "inactive"}
          >
            Stop Service
          </Button>
          <Button
            icon={<FiRotateCw />}
            size="large"
            onClick={handleRestart}
            loading={loading}
            disabled={loading || !serviceInfo || serviceInfo.status === "inactive"}
          >
            Restart Service
          </Button>
        </Flex>

        <Alert
          type="info"
          message="Service Control Tips"
          description={
            <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
              <li>Use <strong>Start</strong> to begin the addon service</li>
              <li>Use <strong>Stop</strong> to halt the service (users won't be able to stream)</li>
              <li>Use <strong>Restart</strong> to apply configuration changes</li>
              <li>Enable <strong>Auto-start</strong> to automatically start the service on system boot</li>
            </ul>
          }
          style={{ marginTop: 16 }}
        />
      </Card>

      {/* Quick Actions */}
      <Card title="Quick Actions">
        <Space direction="vertical" style={{ width: "100%" }}>
          <Flex justify="space-between" align="center">
            <div>
              <Text strong>View Logs</Text>
              <br />
              <Text type="secondary">Check service logs for debugging</Text>
            </div>
            <Button onClick={() => window.location.hash = "#/logs"}>Go to Logs</Button>
          </Flex>
          <Flex justify="space-between" align="center">
            <div>
              <Text strong>Edit Configuration</Text>
              <br />
              <Text type="secondary">Modify addon settings</Text>
            </div>
            <Button onClick={() => window.location.hash = "#/configuration"}>Go to Configuration</Button>
          </Flex>
        </Space>
      </Card>
    </Flex>
  );
}

export default ServiceControl;
