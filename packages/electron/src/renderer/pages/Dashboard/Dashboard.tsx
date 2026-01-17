/**
 * Dashboard Page
 * Main overview page showing addon status and quick actions
 */

import { useEffect, useState } from "react";
import { useAtom } from "jotai";
import { Card, Flex, Typography, Button, Tag, Spin, Alert, Modal, message } from "antd";
import { FiPlay, FiPause, FiRotateCw, FiDownload, FiSettings } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import { configAtom, configExistsAtom } from "../../atoms/configAtoms";
import { serviceStatusAtom, serviceLoadingAtom } from "../../atoms/serviceAtoms";
import { selectedAddonIdAtom, selectedAddonAtom } from "../../atoms/addonAtoms";
import styles from "./Dashboard.module.scss";

const { Title, Text, Paragraph } = Typography;

function Dashboard() {
  const navigate = useNavigate();
  const [config, setConfig] = useAtom(configAtom);
  const [configExists, setConfigExists] = useAtom(configExistsAtom);
  const [serviceStatus, setServiceStatus] = useAtom(serviceStatusAtom);
  const [serviceLoading, setServiceLoading] = useAtom(serviceLoadingAtom);
  const [selectedAddonId] = useAtom(selectedAddonIdAtom);
  const [selectedAddon] = useAtom(selectedAddonAtom);

  const [migrationModalVisible, setMigrationModalVisible] = useState(false);

  useEffect(() => {
    checkMigration();
    loadConfig();
    loadServiceStatus();
  }, [selectedAddonId]);

  async function checkMigration() {
    try {
      const result = await window.electron.migration.check();
      if (result.success && result.data) {
        // Legacy config exists, show migration prompt
        setMigrationModalVisible(true);
      }
    } catch (error) {
      console.error("Failed to check migration", error);
    }
  }

  async function handleMigrate() {
    try {
      const result = await window.electron.migration.migrate();
      if (result.success) {
        message.success(`Migration completed! Addon ID: ${result.data}`);
        setMigrationModalVisible(false);
        // Re-check migration status to ensure modal doesn't show again
        await checkMigration();
        // Reload addons and config
        window.location.reload();
      } else {
        message.error(result.error || "Migration failed");
      }
    } catch (error) {
      message.error("Migration failed");
      console.error(error);
    }
  }

  async function loadConfig() {
    const result = await window.electron.config.exists(selectedAddonId || undefined);
    if (result.success && result.data) {
      setConfigExists(true);
      const configResult = await window.electron.config.load(selectedAddonId || undefined);
      if (configResult.success) {
        setConfig(configResult.data as any);
      }
    } else {
      setConfigExists(false);
      setConfig(null);
    }
  }

  async function loadServiceStatus() {
    setServiceLoading(true);
    const result = await window.electron.service.status(undefined, selectedAddonId || undefined);
    setServiceLoading(false);
    if (result.success) {
      setServiceStatus(result.data as any);
    }
  }

  async function handleServiceAction(action: "start" | "stop" | "restart") {
    setServiceLoading(true);
    await window.electron.service[action](undefined, selectedAddonId || undefined);
    await loadServiceStatus();
  }

  function getStatusColor(status?: string) {
    switch (status) {
      case "active":
        return "success";
      case "inactive":
        return "default";
      case "failed":
        return "error";
      default:
        return "default";
    }
  }

  if (!configExists) {
    return (
      <Flex vertical gap={24} className={styles.dashboard}>
        <Title level={2}>Welcome to Stremio Addon Manager</Title>
        <Alert
          message="No Configuration Found"
          description="Get started by installing your addon. The installation wizard will guide you through the setup process."
          type="info"
          showIcon
        />
        <Button type="primary" size="large" icon={<FiDownload />} onClick={() => navigate("/installation")}>
          Start Installation
        </Button>
      </Flex>
    );
  }

  return (
    <Flex vertical gap={24} className={styles.dashboard}>
      <Flex justify="space-between" align="center">
        <Title level={2}>Dashboard</Title>
        {selectedAddon && (
          <Tag color="blue">
            {selectedAddon.name} ({selectedAddon.id})
          </Tag>
        )}
      </Flex>

      {/* Service Status Card */}
      <Card
        title="Service Status"
        extra={
          <Button icon={<FiRotateCw />} onClick={loadServiceStatus}>
            Refresh
          </Button>
        }
      >
        <Spin spinning={serviceLoading}>
          <Flex vertical gap={16}>
            <Flex justify="space-between" align="center">
              <Text>Status</Text>
              <Tag color={getStatusColor(serviceStatus?.status)}>
                {serviceStatus?.status?.toUpperCase() || "UNKNOWN"}
              </Tag>
            </Flex>
            <Flex justify="space-between" align="center">
              <Text>Auto-start</Text>
              <Tag color={serviceStatus?.enabled ? "success" : "default"}>
                {serviceStatus?.enabled ? "ENABLED" : "DISABLED"}
              </Tag>
            </Flex>
            <Flex gap={8}>
              <Button
                icon={<FiPlay />}
                onClick={() => handleServiceAction("start")}
                disabled={serviceStatus?.status === "active"}
              >
                Start
              </Button>
              <Button
                icon={<FiPause />}
                onClick={() => handleServiceAction("stop")}
                disabled={serviceStatus?.status !== "active"}
              >
                Stop
              </Button>
              <Button icon={<FiRotateCw />} onClick={() => handleServiceAction("restart")}>
                Restart
              </Button>
            </Flex>
          </Flex>
        </Spin>
      </Card>

      {/* Addon Information Card */}
      {config && (
        <Card title="Addon Information">
          <Flex vertical gap={12}>
            <Flex justify="space-between">
              <Text strong>Addon Name</Text>
              <Text>{config.addon.name}</Text>
            </Flex>
            <Flex justify="space-between">
              <Text strong>Domain</Text>
              <Text copyable>{config.addon.domain}</Text>
            </Flex>
            <Flex justify="space-between">
              <Text strong>Provider</Text>
              <Tag>{config.addon.provider.toUpperCase()}</Tag>
            </Flex>
            <Flex justify="space-between">
              <Text strong>Torrent Limit</Text>
              <Text>{config.addon.torrentLimit}</Text>
            </Flex>
            <Flex justify="space-between">
              <Text strong>SSL Enabled</Text>
              <Tag color={config.features.ssl ? "success" : "default"}>{config.features.ssl ? "YES" : "NO"}</Tag>
            </Flex>
          </Flex>
        </Card>
      )}

      {/* Quick Actions Card */}
      <Card title="Quick Actions">
        <Flex gap={8}>
          <Button icon={<FiSettings />} onClick={() => navigate("/configuration")}>
            Configuration
          </Button>
          <Button onClick={() => navigate("/logs")}>View Logs</Button>
        </Flex>
      </Card>

      {/* Install URL */}
      {config && serviceStatus?.status === "active" && (
        <Alert
          message="Addon URL"
          description={
            <Flex vertical gap={8}>
              <Paragraph copyable style={{ margin: 0 }}>
                {`https://${config.addon.domain}/${config.addon.password}/manifest.json`}
              </Paragraph>
              <Text type="secondary">Copy this URL and paste it in Stremio to install your addon</Text>
            </Flex>
          }
          type="success"
          showIcon
        />
      )}

      {/* Migration Modal */}
      <Modal
        title="Legacy Configuration Detected"
        open={migrationModalVisible}
        onOk={handleMigrate}
        onCancel={() => setMigrationModalVisible(false)}
        okText="Migrate Now"
        cancelText="Later"
        width={600}
      >
        <Alert
          message="Migration Required"
          description={
            <div>
              <p>
                A legacy configuration file was detected. To use the new multi-addon features, we need to migrate your
                existing configuration.
              </p>
              <p style={{ marginTop: 12 }}>
                <strong>What will be migrated:</strong>
              </p>
              <ul>
                <li>Configuration file moved to addon-specific location</li>
                <li>Addon registered in the new registry system</li>
                <li>Service name updated (if service exists)</li>
                <li>Paths updated to be addon-specific</li>
                <li>Legacy config backed up</li>
              </ul>
              <p style={{ marginTop: 12, color: "#faad14" }}>
                <strong>Note:</strong> This process is safe and your original config will be backed up.
              </p>
            </div>
          }
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
        />
      </Modal>
    </Flex>
  );
}

export default Dashboard;
