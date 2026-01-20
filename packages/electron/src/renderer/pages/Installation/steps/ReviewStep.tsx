/**
 * Review Step
 * Review all settings before starting installation
 */

import { useState } from "react";
import { Button, Flex, Typography, Card, Descriptions, Tag, Alert } from "antd";
import { useSetAtom } from "jotai";
import { isInstallingAtom, installationResultAtom, installationErrorAtom } from "../../../atoms/installationAtoms";

const { Title, Text } = Typography;

interface ReviewStepProps {
  installationType: "local" | "remote";
  sshConfig: any;
  addonConfig: any;
  accessMethod: string;
  features: any;
  onBack: () => void;
}

function ReviewStep({ installationType, sshConfig, addonConfig, accessMethod, features, onBack }: ReviewStepProps) {
  const [starting, setStarting] = useState(false);
  const setIsInstalling = useSetAtom(isInstallingAtom);
  const setInstallationResult = useSetAtom(installationResultAtom);
  const setInstallationError = useSetAtom(installationErrorAtom);

  async function handleStartInstallation() {
    setStarting(true);
    setIsInstalling(true);

    const installationConfig = {
      config: {
        installation: {
          type: installationType,
          accessMethod,
          ...(installationType === "remote" && sshConfig ? { target: sshConfig } : {}),
        },
        addon: addonConfig,
        features,
        paths: {
          addonDirectory: "/opt/stremio-addon",
          nginxConfig: "/etc/nginx/sites-available/stremio-addon",
          serviceFile: "/etc/systemd/system/stremio-addon.service",
          logs: "/var/log/stremio-addon",
          backups: "/var/backups/stremio-addon",
        },
        secrets: {
          // Trim tokens and only include non-empty ones
          ...(addonConfig.realDebridToken?.trim() ? { realDebridToken: addonConfig.realDebridToken.trim() } : {}),
          ...(addonConfig.alldebridToken?.trim() ? { alldebridToken: addonConfig.alldebridToken.trim() } : {}),
          ...(addonConfig.premiumizeToken?.trim() ? { premiumizeToken: addonConfig.premiumizeToken.trim() } : {}),
          ...(addonConfig.torboxToken?.trim() ? { torboxToken: addonConfig.torboxToken.trim() } : {}),
        },
      },
    };

    try {
      const result = await window.electron.install.start(installationConfig);

      if (result.success) {
        setInstallationResult(result.data as any);
      } else {
        setInstallationError(result.error || "Installation failed");
        setInstallationResult({
          success: false,
          config: installationConfig.config as any,
          addonUrl: "",
          installManifestUrl: "",
          steps: [],
          error: new Error(result.error || "Installation failed"),
          duration: 0,
        });
      }
    } catch (error) {
      const errorMessage = (error as Error).message;
      setInstallationError(errorMessage);
      setInstallationResult({
        success: false,
        config: installationConfig.config as any,
        addonUrl: "",
        installManifestUrl: "",
        steps: [],
        error: error as Error,
        duration: 0,
      });
    } finally {
      setStarting(false);
      setIsInstalling(false);
    }
  }

  const accessMethodLabels: Record<string, string> = {
    custom_domain: "Custom Domain",
    duckdns: "DuckDNS",
    static_ip_domain: "Static IP + DuckDNS",
    local_network: "Local Network Only",
  };

  return (
    <Flex vertical gap={24}>
      <Flex vertical gap={8}>
        <Title level={4}>Review Configuration</Title>
        <Text type="secondary">Please review your settings before starting the installation.</Text>
      </Flex>

      <Alert
        message="Ready to Install"
        description="Once you click 'Start Installation', the process will begin automatically. This may take several minutes."
        type="info"
        showIcon
      />

      <Card title="Installation Type" size="small">
        <Descriptions column={1} size="small">
          <Descriptions.Item label="Type">
            <Tag color={installationType === "local" ? "blue" : "green"}>
              {installationType === "local" ? "Local" : "Remote (SSH)"}
            </Tag>
          </Descriptions.Item>
          {installationType === "remote" && sshConfig && (
            <>
              <Descriptions.Item label="Host">{sshConfig.host}</Descriptions.Item>
              <Descriptions.Item label="Port">{sshConfig.port}</Descriptions.Item>
              <Descriptions.Item label="Username">{sshConfig.username}</Descriptions.Item>
            </>
          )}
        </Descriptions>
      </Card>

      <Card title="Addon Configuration" size="small">
        <Descriptions column={1} size="small">
          <Descriptions.Item label="Name">{addonConfig?.name}</Descriptions.Item>
          <Descriptions.Item label="Domain">{addonConfig?.domain}</Descriptions.Item>
          <Descriptions.Item label="Provider">
            <Tag>{addonConfig?.provider?.toUpperCase()}</Tag>
          </Descriptions.Item>
          {(addonConfig?.realDebridToken || addonConfig?.alldebridToken || addonConfig?.premiumizeToken || addonConfig?.torboxToken) && (
            <Descriptions.Item label="API Token">
              {addonConfig?.realDebridToken && "✓ Real-Debrid token set"}
              {addonConfig?.alldebridToken && "✓ AllDebrid token set"}
              {addonConfig?.premiumizeToken && "✓ Premiumize token set"}
              {addonConfig?.torboxToken && "✓ TorBox token set"}
            </Descriptions.Item>
          )}
          <Descriptions.Item label="Torrent Limit">{addonConfig?.torrentLimit}</Descriptions.Item>
          <Descriptions.Item label="Port">{addonConfig?.port}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="Access Method" size="small">
        <Tag color="blue">{accessMethodLabels[accessMethod]}</Tag>
      </Card>

      <Card title="Features" size="small">
        <Flex wrap="wrap" gap={8}>
          {features?.firewall && <Tag color="success">Firewall</Tag>}
          {features?.fail2ban && <Tag color="success">fail2ban</Tag>}
          {features?.caching?.enabled && <Tag color="success">Caching</Tag>}
          {features?.rateLimiting?.enabled && <Tag color="success">Rate Limiting</Tag>}
          {features?.authentication && <Tag color="success">Authentication</Tag>}
          {features?.backups?.enabled && <Tag color="success">Backups</Tag>}
          {features?.ssl && <Tag color="success">SSL/HTTPS</Tag>}
          {features?.duckdnsUpdater && <Tag color="success">DuckDNS Updater</Tag>}
          {features?.autoStart && <Tag color="success">Auto-start</Tag>}
        </Flex>
        {features?.ssl && features?.sslEmail && (
          <Descriptions column={1} size="small" style={{ marginTop: 16 }}>
            <Descriptions.Item label="SSL Email">{features.sslEmail}</Descriptions.Item>
          </Descriptions>
        )}
      </Card>

      <Flex justify="space-between">
        <Button onClick={onBack} disabled={starting}>
          Back
        </Button>
        <Button type="primary" onClick={handleStartInstallation} loading={starting} size="large">
          {starting ? "Starting Installation..." : "Start Installation"}
        </Button>
      </Flex>
    </Flex>
  );
}

export default ReviewStep;
