/**
 * Connect to Server Page
 * Connect to existing Stremio addon servers
 */

import { useState, useEffect } from "react";
import { useAtom } from "jotai";
import {
  Card,
  Flex,
  Typography,
  Button,
  Input,
  Form,
  Radio,
  message,
  Table,
  Tag,
  Space,
  Modal,
  Tabs,
  Alert,
} from "antd";
import {
  FiServer,
  FiSearch,
  FiRefreshCw,
  FiCheck,
  FiX,
  FiClock,
  FiStar,
  FiTrash2,
} from "react-icons/fi";
import type { ServerInfo, ConnectionProfile } from "@stremio-addon-manager/core";
import {
  connectedServerAtom,
  connectionProfilesAtom,
  localServersAtom,
  serverDetectionLoadingAtom,
  serverConnectionLoadingAtom,
  connectionErrorAtom,
} from "../../atoms/serverAtoms";
import styles from "./Connect.module.scss";

const { Title, Text } = Typography;

interface ServerConnectionConfig {
  url: string;
  auth?: {
    type: "basic" | "token";
    username?: string;
    password?: string;
    token?: string;
  };
}

function Connect() {
  const [form] = Form.useForm();
  const [connectedServer, setConnectedServer] = useAtom(connectedServerAtom);
  const [profiles, setProfiles] = useAtom(connectionProfilesAtom);
  const [localServers, setLocalServers] = useAtom(localServersAtom);
  const [detectionLoading, setDetectionLoading] = useAtom(serverDetectionLoadingAtom);
  const [connectionLoading, setConnectionLoading] = useAtom(serverConnectionLoadingAtom);
  const [connectionError, setConnectionError] = useAtom(connectionErrorAtom);
  const [activeTab, setActiveTab] = useState<string>("manual");
  const [testingUrl, setTestingUrl] = useState<string | null>(null);

  useEffect(() => {
    loadProfiles();
    detectLocalServers();
  }, []);

  async function loadProfiles() {
    const result = await window.electron.profile.load();
    if (result.success && result.data) {
      setProfiles(result.data as ConnectionProfile[]);
    }
  }

  async function detectLocalServers() {
    setDetectionLoading(true);
    const result = await window.electron.server.detectLocal();
    setDetectionLoading(false);

    if (result.success && result.data) {
      setLocalServers(result.data as ServerInfo[]);
      if ((result.data as ServerInfo[]).length > 0) {
        message.success(`Found ${(result.data as ServerInfo[]).length} local server(s)`);
      } else {
        message.info("No local servers found");
      }
    } else {
      message.error("Failed to detect local servers");
    }
  }

  async function handleManualConnect(values: ServerConnectionConfig) {
    setConnectionLoading(true);
    setConnectionError(null);

    const result = await window.electron.server.detect(values.url);
    setConnectionLoading(false);

    if (result.success && result.data) {
      const serverInfo = result.data as ServerInfo;
      setConnectedServer(serverInfo);
      message.success(`Connected to ${serverInfo.name}`);

      // Ask to save as profile
      Modal.confirm({
        title: "Save Connection",
        content: "Would you like to save this connection for future use?",
        onOk: async () => {
          await saveCurrentConnection(values, serverInfo);
        },
      });
    } else {
      setConnectionError(result.error || "Failed to connect to server");
      message.error(result.error || "Failed to connect to server");
    }
  }

  async function saveCurrentConnection(config: ServerConnectionConfig, serverInfo: ServerInfo) {
    const profile = {
      name: serverInfo.name || "Unnamed Server",
      url: config.url,
      type: "remote" as const,
      auth: config.auth,
      metadata: {
        version: serverInfo.version,
        addonName: serverInfo.name,
        description: serverInfo.description,
      },
    };

    const result = await window.electron.profile.save(profile);
    if (result.success) {
      message.success("Connection profile saved");
      await loadProfiles();
    }
  }

  async function handleConnectToLocal(server: ServerInfo) {
    setConnectionLoading(true);
    const result = await window.electron.server.testConnection({ url: server.url });
    setConnectionLoading(false);

    if (result.success && result.data) {
      setConnectedServer(server);
      message.success(`Connected to ${server.name}`);
    } else {
      message.error("Failed to connect to server");
    }
  }

  async function handleConnectToProfile(profile: ConnectionProfile) {
    setConnectionLoading(true);
    const result = await window.electron.profile.test(profile.id);
    setConnectionLoading(false);

    if (result.success && result.data) {
      // Get fresh server info
      const detectResult = await window.electron.server.detect(profile.url);
      if (detectResult.success && detectResult.data) {
        setConnectedServer(detectResult.data as ServerInfo);
        message.success(`Connected to ${profile.name}`);
        
        // Update last connected time
        await window.electron.profile.update(profile.id, {
          lastConnected: new Date(),
        });
        await loadProfiles();
      }
    } else {
      message.error(`Failed to connect to ${profile.name}`);
    }
  }

  async function handleDeleteProfile(id: string) {
    Modal.confirm({
      title: "Delete Profile",
      content: "Are you sure you want to delete this connection profile?",
      okText: "Delete",
      okType: "danger",
      onOk: async () => {
        const result = await window.electron.profile.delete(id);
        if (result.success) {
          message.success("Profile deleted");
          await loadProfiles();
        } else {
          message.error("Failed to delete profile");
        }
      },
    });
  }

  async function handleDisconnect() {
    setConnectedServer(null);
    message.info("Disconnected from server");
  }

  async function handleTestConnection(url: string) {
    setTestingUrl(url);
    const result = await window.electron.server.testConnection({ url });
    setTestingUrl(null);

    if (result.success && result.data) {
      message.success("Connection successful!");
    } else {
      message.error("Connection failed");
    }
  }

  const localServersColumns = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: "URL",
      dataIndex: "url",
      key: "url",
      render: (url: string) => <Text code>{url}</Text>,
    },
    {
      title: "Version",
      dataIndex: "version",
      key: "version",
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      render: (status: string) => (
        <Tag color={status === "online" ? "green" : "red"}>{status.toUpperCase()}</Tag>
      ),
    },
    {
      title: "Response Time",
      dataIndex: "responseTime",
      key: "responseTime",
      render: (time: number) => <Text>{time}ms</Text>,
    },
    {
      title: "Action",
      key: "action",
      render: (_: unknown, record: ServerInfo) => (
        <Button type="primary" size="small" onClick={() => handleConnectToLocal(record)}>
          Connect
        </Button>
      ),
    },
  ];

  const profilesColumns = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      render: (name: string, record: ConnectionProfile) => (
        <Space>
          {record.favorite && <FiStar style={{ color: "#faad14" }} />}
          <Text strong>{name}</Text>
        </Space>
      ),
    },
    {
      title: "URL",
      dataIndex: "url",
      key: "url",
      render: (url: string) => <Text code>{url}</Text>,
    },
    {
      title: "Type",
      dataIndex: "type",
      key: "type",
      render: (type: string) => <Tag>{type.toUpperCase()}</Tag>,
    },
    {
      title: "Last Connected",
      dataIndex: "lastConnected",
      key: "lastConnected",
      render: (date: Date | undefined) => (
        <Space>
          <FiClock />
          <Text>{date ? new Date(date).toLocaleString() : "Never"}</Text>
        </Space>
      ),
    },
    {
      title: "Actions",
      key: "actions",
      render: (_: unknown, record: ConnectionProfile) => (
        <Space>
          <Button type="primary" size="small" onClick={() => handleConnectToProfile(record)}>
            Connect
          </Button>
          <Button
            danger
            size="small"
            icon={<FiTrash2 />}
            onClick={() => handleDeleteProfile(record.id)}
          />
        </Space>
      ),
    },
  ];

  const tabItems = [
    {
      key: "manual",
      label: "Manual Connect",
      children: (
        <Card>
          <Form form={form} layout="vertical" onFinish={handleManualConnect}>
            <Form.Item
              label="Server URL"
              name="url"
              rules={[
                { required: true, message: "Please enter server URL" },
                { type: "url", message: "Please enter a valid URL" },
              ]}
            >
              <Input
                placeholder="http://localhost:3000 or https://your-server.com"
                size="large"
                prefix={<FiServer />}
              />
            </Form.Item>

            <Form.Item label="Authentication (Optional)" name={["auth", "type"]}>
              <Radio.Group>
                <Radio value={null}>None</Radio>
                <Radio value="basic">Basic Auth</Radio>
                <Radio value="token">Token</Radio>
              </Radio.Group>
            </Form.Item>

            <Form.Item noStyle shouldUpdate>
              {({ getFieldValue }) => {
                const authType = getFieldValue(["auth", "type"]);

                if (authType === "basic") {
                  return (
                    <>
                      <Form.Item label="Username" name={["auth", "username"]}>
                        <Input />
                      </Form.Item>
                      <Form.Item label="Password" name={["auth", "password"]}>
                        <Input.Password />
                      </Form.Item>
                    </>
                  );
                }

                if (authType === "token") {
                  return (
                    <Form.Item label="Access Token" name={["auth", "token"]}>
                      <Input.Password />
                    </Form.Item>
                  );
                }

                return null;
              }}
            </Form.Item>

            {connectionError && (
              <Alert type="error" message={connectionError} style={{ marginBottom: 16 }} />
            )}

            <Space>
              <Button type="primary" htmlType="submit" loading={connectionLoading} size="large">
                Connect
              </Button>
              <Button
                onClick={() => handleTestConnection(form.getFieldValue("url"))}
                loading={testingUrl === form.getFieldValue("url")}
                disabled={!form.getFieldValue("url")}
              >
                Test Connection
              </Button>
            </Space>
          </Form>
        </Card>
      ),
    },
    {
      key: "local",
      label: "Local Servers",
      children: (
        <Card>
          <Flex justify="space-between" align="center" style={{ marginBottom: 16 }}>
            <Text>Automatically detected servers on this machine</Text>
            <Button
              icon={<FiRefreshCw />}
              onClick={detectLocalServers}
              loading={detectionLoading}
            >
              Refresh
            </Button>
          </Flex>

          <Table
            dataSource={localServers}
            columns={localServersColumns}
            rowKey="url"
            loading={detectionLoading}
            locale={{ emptyText: "No local servers found. Start a server and click Refresh." }}
          />
        </Card>
      ),
    },
    {
      key: "profiles",
      label: "Saved Profiles",
      children: (
        <Card>
          <Table
            dataSource={profiles}
            columns={profilesColumns}
            rowKey="id"
            locale={{ emptyText: "No saved connection profiles. Connect to a server to create one." }}
          />
        </Card>
      ),
    },
  ];

  if (connectedServer) {
    return (
      <Flex vertical gap={24} className={styles.connect}>
        <Flex justify="space-between" align="center">
          <Title level={2}>Connected to Server</Title>
          <Button danger icon={<FiX />} onClick={handleDisconnect}>
            Disconnect
          </Button>
        </Flex>

        <Card>
          <Flex vertical gap={16}>
            <Flex align="center" gap={16}>
              <FiCheck size={48} style={{ color: "#52c41a" }} />
              <div>
                <Title level={4} style={{ margin: 0 }}>
                  {connectedServer.name}
                </Title>
                <Text type="secondary">{connectedServer.url}</Text>
              </div>
            </Flex>

            <Alert
              type="success"
              message="Successfully Connected"
              description="You are now connected to this addon server. You can view its configuration and manage it from other pages."
              showIcon
            />

            <Flex gap={16} wrap="wrap">
              <Card size="small" style={{ flex: 1 }}>
                <Text type="secondary">Version</Text>
                <br />
                <Text strong>{connectedServer.version}</Text>
              </Card>
              <Card size="small" style={{ flex: 1 }}>
                <Text type="secondary">Status</Text>
                <br />
                <Tag color="green">{connectedServer.status.toUpperCase()}</Tag>
              </Card>
              <Card size="small" style={{ flex: 1 }}>
                <Text type="secondary">Response Time</Text>
                <br />
                <Text strong>{connectedServer.responseTime}ms</Text>
              </Card>
              <Card size="small" style={{ flex: 1 }}>
                <Text type="secondary">Protocol</Text>
                <br />
                <Text strong>{connectedServer.protocol.toUpperCase()}</Text>
              </Card>
            </Flex>

            {connectedServer.description && (
              <div>
                <Text type="secondary">Description:</Text>
                <br />
                <Text>{connectedServer.description}</Text>
              </div>
            )}

            <Space>
              <Button onClick={() => window.location.hash = "#/service"}>
                Service Control
              </Button>
              <Button onClick={() => window.location.hash = "#/logs"}>
                View Logs
              </Button>
              <Button onClick={() => window.location.hash = "#/configuration"}>
                Configuration
              </Button>
            </Space>
          </Flex>
        </Card>
      </Flex>
    );
  }

  return (
    <Flex vertical gap={24} className={styles.connect}>
      <Flex justify="space-between" align="center">
        <Title level={2}>Connect to Server</Title>
        <Button icon={<FiSearch />} onClick={detectLocalServers} loading={detectionLoading}>
          Scan Local
        </Button>
      </Flex>

      <Alert
        type="info"
        message="Connect to an existing Stremio addon server"
        description="You can connect to a server running on this machine, on your local network, or remotely via URL."
        showIcon
      />

      <Tabs items={tabItems} activeKey={activeTab} onChange={setActiveTab} />
    </Flex>
  );
}

export default Connect;

