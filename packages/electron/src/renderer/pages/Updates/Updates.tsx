/**
 * Updates Page
 * Manage addon package updates
 */

import { useEffect, useState } from "react";
import { useAtom } from "jotai";
import {
  Card,
  Flex,
  Typography,
  Button,
  Table,
  Tag,
  Space,
  Alert,
  Modal,
  Progress,
  message,
  Tooltip,
} from "antd";
import {
  FiRefreshCw,
  FiDownload,
  FiClock,
  FiCheck,
  FiAlertCircle,
  FiRotateCcw,
} from "react-icons/fi";
import type { ColumnsType } from "antd/es/table";
import { addonListAtom } from "../../atoms/addonAtoms";
import { updateProgressAtom } from "../../atoms/updateAtoms";
import type { AddonMetadata } from "@stremio-addon-manager/core";
import styles from "./Updates.module.scss";

const { Title, Text } = Typography;

interface AddonUpdateInfo extends AddonMetadata {
  updateAvailable?: boolean;
  latestVersion?: string;
  currentVersion?: string;
  checking?: boolean;
}

function Updates() {
  const [addonList] = useAtom(addonListAtom);
  const [updateProgress] = useAtom(updateProgressAtom);
  const [addonsWithUpdateInfo, setAddonsWithUpdateInfo] = useState<AddonUpdateInfo[]>([]);
  const [checking, setChecking] = useState(false);
  const [updatingAddon, setUpdatingAddon] = useState<string | null>(null);

  useEffect(() => {
    if (addonList.length > 0) {
      checkAllUpdates();
    }
  }, [addonList]);

  async function checkAllUpdates() {
    setChecking(true);
    const updatedList: AddonUpdateInfo[] = [];

    for (const addon of addonList) {
      try {
        if (!window.electron?.update?.checkForUpdates) {
          console.warn("Update API not available");
          updatedList.push({
            ...addon,
            updateAvailable: false,
            checking: false,
          });
          continue;
        }

        const result = await window.electron.update.checkForUpdates(addon.id);
        
        if (result.success && result.data) {
          updatedList.push({
            ...addon,
            updateAvailable: result.data.updateAvailable,
            latestVersion: result.data.latestVersion,
            currentVersion: result.data.currentVersion,
            checking: false,
          });
        } else {
          updatedList.push({
            ...addon,
            updateAvailable: false,
            currentVersion: addon.version,
            checking: false,
          });
        }
      } catch (error) {
        console.error(`Failed to check updates for ${addon.id}`, error);
        updatedList.push({
          ...addon,
          updateAvailable: false,
          checking: false,
        });
      }
    }

    setAddonsWithUpdateInfo(updatedList);
    setChecking(false);
  }

  async function handleUpdateAddon(addonId: string) {
    if (!window.electron?.update?.updateAddon) {
      message.error("Update API not available");
      return;
    }

    setUpdatingAddon(addonId);
    
    try {
      const result = await window.electron.update.updateAddon(addonId, {
        skipBackup: false,
        restartService: true,
      });

      if (result.success) {
        message.success(`Addon ${addonId} updated successfully!`);
        // Refresh the update info
        await checkAllUpdates();
      } else {
        message.error(result.error || "Update failed");
      }
    } catch (error) {
      message.error("Update failed");
      console.error(error);
    } finally {
      setUpdatingAddon(null);
    }
  }

  async function handleUpdateAll() {
    const addonsToUpdate = addonsWithUpdateInfo.filter(a => a.updateAvailable).map(a => a.id);
    
    if (addonsToUpdate.length === 0) {
      message.info("All addons are up to date");
      return;
    }

    if (!window.electron?.update?.updateMultiple) {
      message.error("Update API not available");
      return;
    }

    Modal.confirm({
      title: "Update All Addons",
      content: `Are you sure you want to update ${addonsToUpdate.length} addon(s)?`,
      onOk: async () => {
        try {
          const result = await window.electron.update.updateMultiple(addonsToUpdate, {
            skipBackup: false,
            restartService: true,
          });

          if (result.success) {
            message.success("All addons updated successfully!");
            await checkAllUpdates();
          } else {
            message.error(result.error || "Batch update failed");
          }
        } catch (error) {
          message.error("Batch update failed");
          console.error(error);
        }
      },
    });
  }

  async function handleRollback(addonId: string) {
    if (!window.electron?.update?.rollback) {
      message.error("Rollback API not available");
      return;
    }

    Modal.confirm({
      title: "Rollback Addon",
      content: `Are you sure you want to rollback ${addonId} to the previous version?`,
      onOk: async () => {
        try {
          const result = await window.electron.update.rollback(addonId, {
            restartService: true,
          });

          if (result.success) {
            message.success("Rollback successful!");
            await checkAllUpdates();
          } else {
            message.error(result.error || "Rollback failed");
          }
        } catch (error) {
          message.error("Rollback failed");
          console.error(error);
        }
      },
    });
  }

  const columns: ColumnsType<AddonUpdateInfo> = [
    {
      title: "Addon Name",
      dataIndex: "name",
      key: "name",
      render: (text: string, record: AddonUpdateInfo) => (
        <Space>
          <Text strong>{text}</Text>
          {record.updateAvailable && <Tag color="orange">Update Available</Tag>}
        </Space>
      ),
    },
    {
      title: "Current Version",
      dataIndex: "currentVersion",
      key: "currentVersion",
      render: (version?: string) => (
        <Text code>{version || "Unknown"}</Text>
      ),
    },
    {
      title: "Latest Version",
      dataIndex: "latestVersion",
      key: "latestVersion",
      render: (version?: string, record: AddonUpdateInfo) => (
        <Space>
          <Text code>{version || "N/A"}</Text>
          {record.updateAvailable && (
            <Tooltip title="New version available">
              <FiAlertCircle color="#faad14" />
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: "Status",
      key: "status",
      render: (_: unknown, record: AddonUpdateInfo) => {
        if (record.checking) {
          return <Tag icon={<FiRefreshCw />} color="processing">Checking...</Tag>;
        }
        if (record.updateAvailable) {
          return <Tag icon={<FiDownload />} color="warning">Update Available</Tag>;
        }
        return <Tag icon={<FiCheck />} color="success">Up to Date</Tag>;
      },
    },
    {
      title: "Actions",
      key: "actions",
      render: (_: unknown, record: AddonUpdateInfo) => (
        <Space>
          {record.updateAvailable && (
            <Button
              type="primary"
              size="small"
              icon={<FiDownload />}
              loading={updatingAddon === record.id}
              onClick={() => handleUpdateAddon(record.id)}
            >
              Update
            </Button>
          )}
          {record.updateHistory && record.updateHistory.length > 0 && (
            <Tooltip title="Rollback to previous version">
              <Button
                size="small"
                icon={<FiRotateCcw />}
                onClick={() => handleRollback(record.id)}
              >
                Rollback
              </Button>
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  const updatesAvailable = addonsWithUpdateInfo.filter(a => a.updateAvailable).length;

  return (
    <Flex vertical gap={24} className={styles.updates}>
      <Flex justify="space-between" align="center">
        <Title level={2}>Updates</Title>
        <Space>
          <Button 
            icon={<FiRefreshCw />} 
            onClick={checkAllUpdates} 
            loading={checking}
          >
            Check for Updates
          </Button>
          {updatesAvailable > 0 && (
            <Button
              type="primary"
              icon={<FiDownload />}
              onClick={handleUpdateAll}
            >
              Update All ({updatesAvailable})
            </Button>
          )}
        </Space>
      </Flex>

      {!window.electron?.update && (
        <Alert
          type="warning"
          message="Update API Not Available"
          description="The update functionality is not available in development mode. Please run the app from built files to use this feature."
          showIcon
        />
      )}

      {updatesAvailable > 0 && (
        <Alert
          type="info"
          message={`${updatesAvailable} Update${updatesAvailable > 1 ? 's' : ''} Available`}
          description="New versions of addon packages (core, CLI, addon-server) are available for your addons."
          showIcon
        />
      )}

      {updateProgress && (
        <Card title="Updating Addon">
          <Flex vertical gap={16}>
            <Text>{updateProgress.message}</Text>
            <Progress 
              percent={updateProgress.progress} 
              status={updateProgress.status === "failed" ? "exception" : "active"}
            />
            <Text type="secondary">
              Current step: {updateProgress.step}
            </Text>
          </Flex>
        </Card>
      )}

      <Card>
        <Table
          columns={columns}
          dataSource={addonsWithUpdateInfo}
          rowKey="id"
          loading={checking}
          pagination={{
            pageSize: 10,
            showTotal: (total) => `Total ${total} addon${total > 1 ? 's' : ''}`,
          }}
        />
      </Card>

      <Card title="Update Information">
        <Flex vertical gap={12}>
          <Text>
            <FiClock style={{ marginRight: 8 }} />
            Automatic update checks run in the background every 6 hours.
          </Text>
          <Text>
            <FiDownload style={{ marginRight: 8 }} />
            Updates include the latest versions of @stremio-addon-manager packages (core, CLI, addon-server).
          </Text>
          <Text>
            <FiRotateCcw style={{ marginRight: 8 }} />
            Backups are created automatically before each update. You can rollback if needed.
          </Text>
        </Flex>
      </Card>
    </Flex>
  );
}

export default Updates;

