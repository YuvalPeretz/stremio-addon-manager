/**
 * Updates Page
 * Manage addon package updates
 */

import { useEffect, useState, type ReactNode } from "react";
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
  Input,
  Upload,
} from "antd";
import {
  FiRefreshCw,
  FiDownload,
  FiClock,
  FiCheck,
  FiAlertCircle,
  FiRotateCcw,
  FiUpload,
} from "react-icons/fi";
import type { ColumnsType } from "antd/es/table";
import type { UploadProps } from "antd";
import { addonListAtom } from "../../atoms/addonAtoms";
import { updateProgressAtom } from "../../atoms/updateAtoms";
import type { AddonManagerConfig, AddonMetadata } from "@stremio-addon-manager/core";
import { isCustomScriptInstall } from "../../utils/addonUrls";
import styles from "./Updates.module.scss";

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

async function readUploadAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

/** Prompt user to paste or pick a deploy script when managementUrl is unreachable. */
function promptDeployScript(options: {
  title: string;
  description: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    let draft = "";
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const beforeUpload: UploadProps["beforeUpload"] = async (file) => {
      try {
        draft = await readUploadAsText(file as unknown as File);
        modal.update({
          content: renderBody(draft),
        });
        message.success(`Loaded ${file.name}`);
      } catch {
        message.error("Failed to read script file");
      }
      return false;
    };

    function renderBody(value: string): ReactNode {
      return (
        <Flex vertical gap={12}>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            {options.description}
          </Paragraph>
          <Upload beforeUpload={beforeUpload} showUploadList={false} accept=".sh,text/*">
            <Button icon={<FiUpload />}>Pick script file…</Button>
          </Upload>
          <TextArea
            rows={12}
            defaultValue={value}
            placeholder="Paste deploy script here…"
            onChange={(e) => {
              draft = e.target.value;
            }}
            style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}
          />
        </Flex>
      );
    }

    const modal = Modal.confirm({
      title: options.title,
      width: 720,
      icon: null,
      content: renderBody(""),
      okText: "Use script and continue",
      cancelText: "Cancel",
      onOk: () => {
        if (!draft.trim()) {
          message.error("Paste or pick a deploy script first");
          return Promise.reject(new Error("empty script"));
        }
        finish(draft);
        return Promise.resolve();
      },
      onCancel: () => finish(null),
    });
  });
}

interface AddonUpdateInfo extends AddonMetadata {
  updateAvailable?: boolean;
  latestVersion?: string;
  currentVersion?: string;
  checking?: boolean;
}

function Updates() {
  const [addonList, setAddonList] = useAtom(addonListAtom);
  const [updateProgress] = useAtom(updateProgressAtom);
  const [addonsWithUpdateInfo, setAddonsWithUpdateInfo] = useState<AddonUpdateInfo[]>([]);
  const [checking, setChecking] = useState(false);
  const [updatingAddon, setUpdatingAddon] = useState<string | null>(null);
  const [customScriptAddonIds, setCustomScriptAddonIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadAddons();
  }, []);

  useEffect(() => {
    if (addonList.length > 0) {
      checkAllUpdates();
    }
  }, [addonList]);

  async function loadAddons() {
    try {
      const result = await window.electron.addon.list();
      if (result.success && result.data) {
        setAddonList(result.data as any[]);
      }
    } catch (error) {
      console.error("Failed to load addons", error);
    }
  }

  async function checkAllUpdates() {
    setChecking(true);
    const updatedList: AddonUpdateInfo[] = [];
    const customIds = new Set<string>();

    for (const addon of addonList) {
      try {
        try {
          const cfgResult = await window.electron.config.load(addon.id);
          if (
            cfgResult.success &&
            cfgResult.data &&
            isCustomScriptInstall(cfgResult.data as AddonManagerConfig)
          ) {
            customIds.add(addon.id);
          }
        } catch {
          // ignore config probe
        }

        if (!window.electron?.update?.check) {
          console.warn("Update API not available");
          updatedList.push({
            ...addon,
            updateAvailable: false,
            checking: false,
          });
          continue;
        }

        const result = await window.electron.update.check(addon.id);
        
        if (result.success && result.data) {
          const info = result.data as {
            updateAvailable?: boolean;
            latestVersion?: string;
            currentVersion?: string;
          };
          updatedList.push({
            ...addon,
            updateAvailable: info.updateAvailable,
            latestVersion: info.latestVersion,
            currentVersion: info.currentVersion,
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

    setCustomScriptAddonIds(customIds);
    setAddonsWithUpdateInfo(updatedList);
    setChecking(false);
  }

  async function handleUpdateAddon(
    addonId: string,
    forceUpdate = false,
    confirmScriptHash?: string,
    scriptContent?: string
  ) {
    if (!window.electron?.update?.addon) {
      message.error("Update API not available");
      return;
    }

    setUpdatingAddon(addonId);

    try {
      const result = await window.electron.update.addon(addonId, {
        skipBackup: false,
        restartService: true,
        forceUpdate,
        confirmScriptHash,
        force: forceUpdate,
        scriptContent,
      });

      if (!result.success && result.requiresScript) {
        setUpdatingAddon(null);
        const pasted = await promptDeployScript({
          title: "Paste/pick deploy script",
          description:
            result.error ||
            "Private admin managementUrl is unreachable and no stored script is available. Paste or pick the same deploy script used at install, then continue.",
        });
        if (!pasted) {
          return;
        }
        await handleUpdateAddon(addonId, forceUpdate, confirmScriptHash, pasted);
        return;
      }

      if (!result.success && result.requiresConfirm && result.scriptHash) {
        const scriptHash = result.scriptHash;
        Modal.confirm({
          title: "Deploy script changed",
          content: `The deploy script hash is now ${scriptHash.slice(0, 16)}…. Confirm to run the update with this script.`,
          okText: "Confirm and update",
          onOk: () => handleUpdateAddon(addonId, forceUpdate, scriptHash, scriptContent),
        });
        return;
      }

      if (result.success) {
        if (result.warning) {
          message.warning(result.warning, 12);
        } else {
          message.success(`Addon ${addonId} ${forceUpdate ? "force " : ""}updated successfully!`);
        }
        await loadAddons();
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

  async function handleForceUpdate(addonId: string) {
    const isCustom = customScriptAddonIds.has(addonId);
    Modal.confirm({
      title: isCustom ? "Force Update (custom script)" : "Force Update",
      content: isCustom ? (
        <div>
          <p>
            This runs your deploy script with <strong>DEPLOY_MODE=update</strong>, staging fresh ADDON + ADMIN
            artifacts (even if version checks look up to date).
          </p>
          <p><strong>Use this if:</strong></p>
          <ul>
            <li>You changed the bundled addon-server build and need to redeploy</li>
            <li>Gateway apps drifted and you want a full script-driven refresh</li>
            <li>A previous update partially failed</li>
          </ul>
          <p style={{ marginTop: 12, color: "#faad14" }}>
            <strong>Note:</strong> No automatic backup/rollback — recovery is owned by your Gateway script.
          </p>
        </div>
      ) : (
        <div>
          <p>This will force reinstall all packages to the latest version, even if already up to date.</p>
          <p><strong>Use this if:</strong></p>
          <ul>
            <li>Version detection is not working correctly</li>
            <li>You want to ensure all packages are at the latest version</li>
            <li>Files may have been corrupted or modified</li>
          </ul>
          <p style={{ marginTop: 12, color: "#faad14" }}>
            <strong>Note:</strong> A backup will be created before the update.
          </p>
        </div>
      ),
      onOk: () => handleUpdateAddon(addonId, true),
      okText: "Force Update",
      okButtonProps: { danger: true },
    });
  }

  async function handleUpdateAll(forceUpdate = false) {
    let addonsToUpdate: string[];
    
    if (forceUpdate) {
      // Force update all addons
      addonsToUpdate = addonsWithUpdateInfo.map(a => a.id);
    } else {
      // Only update addons with updates available
      addonsToUpdate = addonsWithUpdateInfo.filter(a => a.updateAvailable).map(a => a.id);
      
      if (addonsToUpdate.length === 0) {
        message.info("All addons are up to date");
        return;
      }
    }

    if (!window.electron?.update?.multiple) {
      message.error("Update API not available");
      return;
    }

    const customCount = addonsToUpdate.filter((id) => customScriptAddonIds.has(id)).length;
    const classicCount = addonsToUpdate.length - customCount;

    Modal.confirm({
      title: forceUpdate ? "Force Update All Addons" : "Update All Addons",
      content: forceUpdate ? (
        <div>
          <p>
            This will update <strong>{addonsToUpdate.length}</strong> addon(s)
            {customCount > 0 && classicCount > 0
              ? ` (${classicCount} classic SSH, ${customCount} custom script)`
              : customCount > 0
                ? " via custom-script deploy"
                : ""}.
          </p>
          {classicCount > 0 && (
            <p style={{ marginTop: 12, color: "#faad14" }}>
              <strong>Classic:</strong> packages are reinstalled; backups are created before each update.
            </p>
          )}
          {customCount > 0 && (
            <p style={{ marginTop: 12, color: "#faad14" }}>
              <strong>Custom script:</strong> runs DEPLOY_MODE=update with dual artifacts. No automatic
              backup/rollback.
            </p>
          )}
        </div>
      ) : (
        `Are you sure you want to update ${addonsToUpdate.length} addon(s)?`
      ),
      okText: forceUpdate ? "Force Update All" : "Update All",
      okButtonProps: forceUpdate ? { danger: true } : undefined,
      onOk: async () => {
        try {
          const result = await window.electron.update.multiple(addonsToUpdate, {
            skipBackup: false,
            restartService: true,
            forceUpdate,
            force: forceUpdate,
          });

          if (result.success) {
            const rows = Array.isArray(result.data) ? (result.data as Array<{ success?: boolean; error?: string; addonId?: string }>) : [];
            const failed = rows.filter((r) => r && r.success === false);
            if (failed.length > 0) {
              message.warning(
                `${rows.length - failed.length} succeeded, ${failed.length} failed. ` +
                  (failed[0]?.error || "Check Updates for details.")
              );
            } else {
              message.success(`All addons ${forceUpdate ? "force " : ""}updated successfully!`);
            }
            await loadAddons();
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
    try {
      const configResult = await window.electron.config.load(addonId);
      if (
        configResult.success &&
        configResult.data &&
        isCustomScriptInstall(configResult.data as AddonManagerConfig)
      ) {
        message.warning(
          "Rollback is not supported for custom_script installs. Use your Gateway/script recovery process."
        );
        return;
      }
    } catch {
      // continue with classic rollback
    }

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
            await loadAddons();
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
      render: (version: string | undefined, record: AddonUpdateInfo) => {
        if (!version || version === "N/A") {
          return (
            <Tooltip title="Version could not be detected. Use 'Force Update' to reinstall.">
              <Space>
                <Text code type="warning">Unknown</Text>
                <FiAlertCircle color="#faad14" size={14} />
              </Space>
            </Tooltip>
          );
        }
        return <Text code>{version}</Text>;
      },
    },
    {
      title: "Latest Version",
      dataIndex: "latestVersion",
      key: "latestVersion",
      render: (version: string | undefined, record: AddonUpdateInfo) => (
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
      width: 300,
      render: (_: unknown, record: AddonUpdateInfo) => (
        <Space size="small" wrap>
          {record.updateAvailable && (
            <Button
              type="primary"
              size="small"
              icon={<FiDownload />}
              loading={updatingAddon === record.id}
              onClick={() => handleUpdateAddon(record.id, false)}
            >
              Update
            </Button>
          )}
          <Tooltip
            title={
              customScriptAddonIds.has(record.id)
                ? "Run deploy script (DEPLOY_MODE=update) with dual artifacts"
                : "Force reinstall packages to latest version"
            }
          >
            <Button
              size="small"
              icon={<FiRefreshCw />}
              loading={updatingAddon === record.id}
              onClick={() => handleForceUpdate(record.id)}
            >
              Force Update
            </Button>
          </Tooltip>
          {record.updateHistory &&
            record.updateHistory.length > 0 &&
            !customScriptAddonIds.has(record.id) && (
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
          {customScriptAddonIds.has(record.id) && (
            <Tooltip title="Rollback is not supported for custom_script installs">
              <Tag>No rollback</Tag>
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
              onClick={() => handleUpdateAll(false)}
            >
              Update All ({updatesAvailable})
            </Button>
          )}
          <Button
            icon={<FiRefreshCw />}
            onClick={() => handleUpdateAll(true)}
          >
            Force Update All
          </Button>
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

      {customScriptAddonIds.size > 0 && (
        <Alert
          type="info"
          showIcon
          message="Custom script updates"
          description="Force Update runs your deploy script (DEPLOY_MODE=update) with dual artifacts. Scripts are fetched from managementUrl when reachable; otherwise the last stored script is used. If neither is available, you can paste/pick the script. Hash changes still require confirm. Rollback is not supported."
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

      {addonsWithUpdateInfo.some(a => !a.currentVersion || a.currentVersion === "N/A") && (
        <Alert
          type="warning"
          message="Version Detection Issue"
          description={
            <div>
              <p>Some addons have unknown versions. This can happen if:</p>
              <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
                <li>The addon was installed manually without version tracking</li>
                <li>The package.json file is missing or corrupted</li>
                <li>The addon is running on a remote server</li>
              </ul>
              <p style={{ marginTop: 8, marginBottom: 0 }}>
                <strong>Solution:</strong> Use the "Force Update" button to reinstall packages to the latest version.
              </p>
            </div>
          }
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
            Backups are created automatically before each classic (SSH) update. You can rollback if needed.
          </Text>
          <Text type="secondary">
            Custom script installs: updates run your deploy script (DEPLOY_MODE=update) with dual artifacts.
            Rollback and remote→custom_script migrate are not supported yet.
          </Text>
        </Flex>
      </Card>
    </Flex>
  );
}

export default Updates;

