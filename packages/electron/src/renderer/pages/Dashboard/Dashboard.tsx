/**
 * Dashboard Page
 * Main overview page showing addon status and quick actions
 */

import { useEffect } from 'react';
import { useAtom } from 'jotai';
import { Card, Flex, Typography, Button, Tag, Spin, Alert } from 'antd';
import { FiPlay, FiPause, FiRotateCw, FiDownload, FiSettings } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import { configAtom, configExistsAtom } from '../../atoms/configAtoms';
import { serviceStatusAtom, serviceLoadingAtom } from '../../atoms/serviceAtoms';
import styles from './Dashboard.module.scss';

const { Title, Text, Paragraph } = Typography;

function Dashboard() {
  const navigate = useNavigate();
  const [config, setConfig] = useAtom(configAtom);
  const [configExists, setConfigExists] = useAtom(configExistsAtom);
  const [serviceStatus, setServiceStatus] = useAtom(serviceStatusAtom);
  const [serviceLoading, setServiceLoading] = useAtom(serviceLoadingAtom);

  useEffect(() => {
    loadConfig();
    loadServiceStatus();
  }, []);

  async function loadConfig() {
    const result = await window.electron.config.exists();
    if (result.success && result.data) {
      setConfigExists(true);
      const configResult = await window.electron.config.load();
      if (configResult.success) {
        setConfig(configResult.data as any);
      }
    }
  }

  async function loadServiceStatus() {
    setServiceLoading(true);
    const result = await window.electron.service.status();
    setServiceLoading(false);
    if (result.success) {
      setServiceStatus(result.data as any);
    }
  }

  async function handleServiceAction(action: 'start' | 'stop' | 'restart') {
    setServiceLoading(true);
    await window.electron.service[action]();
    await loadServiceStatus();
  }

  function getStatusColor(status?: string) {
    switch (status) {
      case 'active':
        return 'success';
      case 'inactive':
        return 'default';
      case 'failed':
        return 'error';
      default:
        return 'default';
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
        <Button
          type="primary"
          size="large"
          icon={<FiDownload />}
          onClick={() => navigate('/installation')}
        >
          Start Installation
        </Button>
      </Flex>
    );
  }

  return (
    <Flex vertical gap={24} className={styles.dashboard}>
      <Title level={2}>Dashboard</Title>

      {/* Service Status Card */}
      <Card title="Service Status" extra={<Button icon={<FiRotateCw />} onClick={loadServiceStatus}>Refresh</Button>}>
        <Spin spinning={serviceLoading}>
          <Flex vertical gap={16}>
            <Flex justify="space-between" align="center">
              <Text>Status</Text>
              <Tag color={getStatusColor(serviceStatus?.status)}>
                {serviceStatus?.status?.toUpperCase() || 'UNKNOWN'}
              </Tag>
            </Flex>
            <Flex justify="space-between" align="center">
              <Text>Auto-start</Text>
              <Tag color={serviceStatus?.enabled ? 'success' : 'default'}>
                {serviceStatus?.enabled ? 'ENABLED' : 'DISABLED'}
              </Tag>
            </Flex>
            <Flex gap={8}>
              <Button
                icon={<FiPlay />}
                onClick={() => handleServiceAction('start')}
                disabled={serviceStatus?.status === 'active'}
              >
                Start
              </Button>
              <Button
                icon={<FiPause />}
                onClick={() => handleServiceAction('stop')}
                disabled={serviceStatus?.status !== 'active'}
              >
                Stop
              </Button>
              <Button
                icon={<FiRotateCw />}
                onClick={() => handleServiceAction('restart')}
              >
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
              <Tag color={config.features.ssl ? 'success' : 'default'}>
                {config.features.ssl ? 'YES' : 'NO'}
              </Tag>
            </Flex>
          </Flex>
        </Card>
      )}

      {/* Quick Actions Card */}
      <Card title="Quick Actions">
        <Flex gap={8}>
          <Button icon={<FiSettings />} onClick={() => navigate('/configuration')}>
            Configuration
          </Button>
          <Button onClick={() => navigate('/logs')}>
            View Logs
          </Button>
        </Flex>
      </Card>

      {/* Install URL */}
      {config && serviceStatus?.status === 'active' && (
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
    </Flex>
  );
}

export default Dashboard;

