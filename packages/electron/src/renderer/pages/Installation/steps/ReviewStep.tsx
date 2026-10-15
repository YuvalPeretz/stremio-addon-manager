/**
 * Review Step
 * Review all settings before starting installation
 */

import { useState } from "react";
import { Button, Flex, Typography, Card, Descriptions, Tag, Alert } from "antd";
import { useSetAtom } from "jotai";
import {
  isInstallingAtom,
  installationResultAtom,
  installationErrorAtom,
  installationProgressAtom,
} from "../../../atoms/installationAtoms";
import type { AddonProduct } from "@stremio-addon-manager/core";
import {
  DEFAULT_LLM_MODEL_ID,
  DEFAULT_TARGET_LANG,
  TRANSLATED_SUBTITLES_DEFAULT_PORT,
  getLlmModelCatalogEntry,
  productLabel,
} from "@stremio-addon-manager/core/browser";
import type { DeployScriptStepValue } from "./DeployScriptStep";
import type { AccessUrlsStepValue } from "./AccessUrlsStep";
import type { WizardInstallationType } from "./InstallationTypeStep";

const { Title, Text } = Typography;

/** Default PORT inside Docker for custom_script dual-app Gateway installs. */
const CUSTOM_SCRIPT_CONTAINER_PORT = 8080;

interface ReviewStepProps {
  product: AddonProduct;
  installationType: WizardInstallationType;
  sshConfig: Record<string, unknown> | null;
  addonConfig: Record<string, unknown> | null;
  providersConfig: Record<string, unknown> | null;
  targetLang?: string;
  llmModelId?: string;
  accessMethod: string;
  features: Record<string, unknown> | null;
  deployScript?: DeployScriptStepValue | null;
  accessUrls?: AccessUrlsStepValue | null;
  onBack: () => void;
}

/** Host + Gateway path prefix (e.g. gateway.example/svc-xxx) — not host-only. */
function domainFromPublicUrl(publicUrl: string): string {
  try {
    const u = new URL(publicUrl.includes("://") ? publicUrl : `https://${publicUrl}`);
    return u.host + (u.pathname && u.pathname !== "/" ? u.pathname.replace(/\/+$/, "") : "");
  } catch {
    return publicUrl.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  }
}

function ReviewStep({
  product,
  installationType,
  sshConfig,
  addonConfig,
  providersConfig,
  targetLang,
  llmModelId,
  accessMethod,
  features,
  deployScript,
  accessUrls,
  onBack,
}: ReviewStepProps) {
  const [starting, setStarting] = useState(false);
  const setIsInstalling = useSetAtom(isInstallingAtom);
  const setInstallationResult = useSetAtom(installationResultAtom);
  const setInstallationError = useSetAtom(installationErrorAtom);
  const setInstallationProgress = useSetAtom(installationProgressAtom);

  const isCustom = installationType === "custom_script";
  const isTranslated = product === "translated_subtitles";
  const configuredReviewPort = (addonConfig as { port?: number } | null)?.port;
  const defaultProductPort = isTranslated || isCustom ? TRANSLATED_SUBTITLES_DEFAULT_PORT : CUSTOM_SCRIPT_CONTAINER_PORT;
  const reviewContainerPort =
    configuredReviewPort && configuredReviewPort > 0
      ? configuredReviewPort
      : defaultProductPort;
  const resolvedTargetLang = targetLang || DEFAULT_TARGET_LANG;
  const resolvedModelId = llmModelId || DEFAULT_LLM_MODEL_ID;
  const modelEntry = getLlmModelCatalogEntry(resolvedModelId);

  async function handleStartInstallation(): Promise<void> {
    setStarting(true);
    // Clear prior attempt so progress/result from a failed run don't stick around
    setInstallationProgress([]);
    setInstallationResult(null);
    setInstallationError(null);
    setIsInstalling(true);

    const configuredPort = (addonConfig as { port?: number })?.port;
    const pc = providersConfig as {
      realDebridToken?: string;
      torboxToken?: string;
      streamProviderMode?: string;
      streamProviderOrder?: string[];
      provider?: string;
    } | null;

    const primaryProvider =
      (addonConfig as { provider?: string } | null)?.provider ||
      pc?.provider ||
      pc?.streamProviderOrder?.[0] ||
      "real-debrid";

    const addonWithProviders = {
      ...addonConfig,
      ...(isTranslated
        ? {
            targetLang: resolvedTargetLang,
            llmModelId: resolvedModelId,
            port:
              configuredPort && configuredPort > 0
                ? configuredPort
                : TRANSLATED_SUBTITLES_DEFAULT_PORT,
          }
        : {
            ...(isCustom || !(addonConfig as { provider?: string } | null)?.provider
              ? { provider: primaryProvider }
              : {}),
            ...(pc?.streamProviderMode ? { streamProviderMode: pc.streamProviderMode } : {}),
            ...(pc?.streamProviderOrder ? { streamProviderOrder: pc.streamProviderOrder } : {}),
          }),
      ...(isCustom && accessUrls?.publicUrl && !(addonConfig as { domain?: string })?.domain
        ? { domain: domainFromPublicUrl(accessUrls.publicUrl) }
        : {}),
      ...(isCustom && !isTranslated
        ? { port: configuredPort && configuredPort > 0 ? configuredPort : CUSTOM_SCRIPT_CONTAINER_PORT }
        : {}),
    };

    // Tokens: ProvidersStep owns them for custom_script; AddonConfig owns RD (etc.) for local/remote.
    // TorBox may come from either step in classic flow.
    const realDebridTokenFinal: string =
      String(pc?.realDebridToken?.trim() || "") ||
      String((addonConfig as { realDebridToken?: string })?.realDebridToken?.trim() || "") ||
      "";
    const torboxTokenFinal: string =
      String(pc?.torboxToken?.trim() || "") ||
      String((addonConfig as { torboxToken?: string })?.torboxToken?.trim() || "") ||
      "";

    const ac = addonConfig as {
      alldebridToken?: string;
      premiumizeToken?: string;
    };

    const defaultFeatures = {
      firewall: false,
      fail2ban: false,
      caching: { enabled: true, ttl: 7200, maxSize: 100 },
      rateLimiting: { enabled: true, stream: 50, stats: 120 },
      authentication: true,
      backups: { enabled: false, frequency: "weekly" as const, retention: 7 },
      ssl: false,
      duckdnsUpdater: false,
      autoStart: true,
    };

    const installationConfig = {
      config: {
        product,
        installation: {
          type: installationType,
          accessMethod: isCustom ? "custom_domain" : accessMethod,
          ...(installationType === "remote" && sshConfig ? { target: sshConfig } : {}),
          ...(isCustom && deployScript && accessUrls
            ? {
                customScript: {
                  artifactMode: deployScript.artifactMode,
                  updateScriptMode: deployScript.updateScriptMode,
                  installScriptRelPath: deployScript.installScriptRelPath,
                  updateScriptRelPath: deployScript.updateScriptRelPath,
                  injectedVars: deployScript.injectedVars,
                  publicUrl: accessUrls.publicUrl,
                  managementUrl: accessUrls.managementUrl,
                  healthPath: accessUrls.healthPath,
                  ...(accessUrls.managerSsh?.trim()
                    ? { managerSsh: accessUrls.managerSsh.trim() }
                    : {}),
                  ...(accessUrls.managerSshPassword?.trim()
                    ? { managerSshPassword: accessUrls.managerSshPassword.trim() }
                    : {}),
                },
              }
            : {}),
        },
        addon: addonWithProviders,
        features: isCustom ? defaultFeatures : features,
        paths: {
          addonDirectory: "/opt/stremio-addon",
          nginxConfig: "/etc/nginx/sites-available/stremio-addon",
          serviceFile: "/etc/systemd/system/stremio-addon.service",
          logs: "/var/log/stremio-addon",
          backups: "/var/backups/stremio-addon",
        },
        secrets: isTranslated
          ? {}
          : {
              ...(realDebridTokenFinal ? { realDebridToken: realDebridTokenFinal } : {}),
              ...(ac?.alldebridToken?.trim() ? { alldebridToken: ac.alldebridToken.trim() } : {}),
              ...(ac?.premiumizeToken?.trim() ? { premiumizeToken: ac.premiumizeToken.trim() } : {}),
              ...(torboxTokenFinal ? { torboxToken: torboxTokenFinal } : {}),
            },
      },
      ...(isCustom && deployScript
        ? {
            scriptContent: deployScript.installScriptContent,
            updateScriptContent: deployScript.updateScriptContent,
          }
        : {}),
    };

    try {
      const result = await window.electron.install.start(installationConfig);

      if (result.success) {
        setInstallationResult(result.data as never);
      } else {
        setInstallationError(result.error || "Installation failed");
        setInstallationResult({
          success: false,
          config: installationConfig.config as never,
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
        config: installationConfig.config as never,
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

  const typeLabel =
    installationType === "local"
      ? "Local"
      : installationType === "remote"
        ? "Remote (SSH)"
        : "Custom script";

  return (
    <Flex vertical gap={24}>
      <Flex vertical gap={8}>
        <Title level={4}>Review Configuration</Title>
        <Text type="secondary">Please review your settings before starting the installation.</Text>
      </Flex>

      <Alert
        message="Ready to Install"
        description={
          isCustom
            ? accessUrls?.managerSsh?.trim()
              ? `Electron will stage ADDON + ADMIN, upload them to ${accessUrls.managerSsh.trim()} via SSH, run bash with DEPLOY_MODE=install (using ADDON_REMOTE_STAGING / ADMIN_REMOTE_STAGING), then verify the public URL.`
              : "Electron will stage ADDON + ADMIN artifacts, embed your scripts, run bash with DEPLOY_MODE=install (your script must upload trees — set Manager SSH to let Electron upload), then verify the public URL."
            : "Once you click 'Start Installation', the process will begin automatically. This may take several minutes."
        }
        type="info"
        showIcon
      />

      <Card title="Installation Type" size="small">
        <Descriptions column={1} size="small">
          <Descriptions.Item label="Product">
            <Tag color={isTranslated ? "geekblue" : "blue"}>{productLabel(product)}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Type">
            <Tag color={isCustom ? "purple" : installationType === "local" ? "blue" : "green"}>
              {typeLabel}
            </Tag>
          </Descriptions.Item>
          {installationType === "remote" && sshConfig && (
            <>
              <Descriptions.Item label="Host">{String(sshConfig.host)}</Descriptions.Item>
              <Descriptions.Item label="Port">{String(sshConfig.port)}</Descriptions.Item>
              <Descriptions.Item label="Username">{String(sshConfig.username)}</Descriptions.Item>
            </>
          )}
        </Descriptions>
      </Card>

      {/* custom_script: Access URLs are the primary access method (not Port) */}
      {isCustom && accessUrls && (
        <Card title="Access URLs" size="small">
          <Descriptions column={1} size="small">
            <Descriptions.Item label="Public URL">
              <Text copyable code>
                {accessUrls.publicUrl}
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label="Management URL">
              <Text copyable code>
                {accessUrls.managementUrl}
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label="Health path">{accessUrls.healthPath}</Descriptions.Item>
            <Descriptions.Item label="Manager SSH">
              {accessUrls.managerSsh?.trim() ? (
                <Text copyable code>
                  {accessUrls.managerSsh.trim()}
                </Text>
              ) : (
                <Text type="secondary">Not set (script must self-upload)</Text>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Manager SSH password">
              {accessUrls.managerSshPassword?.trim() ? (
                <Text type="secondary">Set (not shown)</Text>
              ) : (
                <Text type="secondary">Not set (key auth)</Text>
              )}
            </Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      <Card title="Addon Configuration" size="small">
        <Descriptions column={1} size="small">
          <Descriptions.Item label="Name">{String((addonConfig as { name?: string })?.name || "")}</Descriptions.Item>
          <Descriptions.Item label="Domain">
            {String(
              (addonConfig as { domain?: string })?.domain ||
                (accessUrls ? domainFromPublicUrl(accessUrls.publicUrl) : "")
            )}
          </Descriptions.Item>
          {isTranslated ? (
            <>
              <Descriptions.Item label="Target language">{resolvedTargetLang}</Descriptions.Item>
              <Descriptions.Item label="Model">
                {modelEntry
                  ? `${modelEntry.label} · ${modelEntry.tier} · ${modelEntry.ramBlurb}`
                  : resolvedModelId}
              </Descriptions.Item>
            </>
          ) : (
            <>
              <Descriptions.Item label="Provider">
                {isCustom &&
                ((providersConfig as { streamProviderOrder?: string[] } | null)?.streamProviderOrder
                  ?.length ?? 0) > 0 ? (
                  ((providersConfig as { streamProviderOrder: string[] }).streamProviderOrder || []).map(
                    (id: string) => (
                      <Tag key={id} style={{ marginRight: 4 }}>
                        {id === "real-debrid" ? "Real-Debrid" : id === "torbox" ? "TorBox" : id.toUpperCase()}
                      </Tag>
                    )
                  )
                ) : (
                  <Tag>
                    {String(
                      (providersConfig as { provider?: string } | null)?.provider ||
                        (addonConfig as { provider?: string } | null)?.provider ||
                        ""
                    ).toUpperCase()}
                  </Tag>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Torrent Limit">
                {String((addonConfig as { torrentLimit?: number })?.torrentLimit ?? "")}
              </Descriptions.Item>
            </>
          )}
          {!isCustom && (
            <Descriptions.Item label="Port">
              {String((addonConfig as { port?: number })?.port ?? "")}
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      {providersConfig && !isTranslated && (
        <Card title="Stream Providers" size="small">
          <Descriptions column={1} size="small">
            <Descriptions.Item label="Active Providers">
              {((providersConfig as { streamProviderOrder?: string[] }).streamProviderOrder || []).map(
                (id: string) => (
                  <Tag key={id} color="blue" style={{ marginRight: 4 }}>
                    {id === "real-debrid" ? "Real-Debrid" : id === "torbox" ? "TorBox" : id}
                  </Tag>
                )
              )}
            </Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      {isCustom && deployScript && (
        <>
          <Card title="Deploy Script" size="small">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="Artifact mode">{deployScript.artifactMode}</Descriptions.Item>
              <Descriptions.Item label="Update script">{deployScript.updateScriptMode}</Descriptions.Item>
              <Descriptions.Item label="Install path">{deployScript.installScriptRelPath}</Descriptions.Item>
              {deployScript.updateScriptMode === "separate" && (
                <Descriptions.Item label="Update path">{deployScript.updateScriptRelPath}</Descriptions.Item>
              )}
              <Descriptions.Item label="Script length">
                {deployScript.installScriptContent.length} chars
              </Descriptions.Item>
            </Descriptions>
          </Card>
          <Card title="Advanced / env" size="small">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="Container PORT (inside Docker)">
                {String(reviewContainerPort)}
              </Descriptions.Item>
            </Descriptions>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Written to ADDON_ENV / ADMIN_ENV as PORT. Host publish ports are set in your deploy script.
            </Text>
          </Card>
          <Alert
            type="warning"
            showIcon
            message="Deferred for custom script"
            description={
              isTranslated
                ? "Rollback and remote→custom_script migrate are not supported yet for Translated Subtitles. Your Gateway script owns recovery."
                : "Rollback, remote→custom_script migrate, and Party deploy via this app are not supported yet. Your Gateway script owns recovery."
            }
          />
        </>
      )}

      {!isCustom && (
        <>
          <Card title="Access Method" size="small">
            <Tag color="blue">{accessMethodLabels[accessMethod]}</Tag>
          </Card>
          <Card title="Features" size="small">
            <Flex wrap="wrap" gap={8}>
              {(features as { firewall?: boolean })?.firewall && <Tag color="success">Firewall</Tag>}
              {(features as { fail2ban?: boolean })?.fail2ban && <Tag color="success">fail2ban</Tag>}
              {(features as { caching?: { enabled?: boolean } })?.caching?.enabled && (
                <Tag color="success">Caching</Tag>
              )}
              {(features as { rateLimiting?: { enabled?: boolean } })?.rateLimiting?.enabled && (
                <Tag color="success">Rate Limiting</Tag>
              )}
              {(features as { authentication?: boolean })?.authentication && (
                <Tag color="success">Authentication</Tag>
              )}
              {(features as { backups?: { enabled?: boolean } })?.backups?.enabled && (
                <Tag color="success">Backups</Tag>
              )}
              {(features as { ssl?: boolean })?.ssl && <Tag color="success">SSL/HTTPS</Tag>}
              {(features as { autoStart?: boolean })?.autoStart && <Tag color="success">Auto-start</Tag>}
            </Flex>
          </Card>
        </>
      )}

      <Flex justify="space-between">
        <Button onClick={onBack} disabled={starting}>
          Back
        </Button>
        <Button
          type="primary"
          onClick={() => void handleStartInstallation()}
          loading={starting}
          size="large"
          disabled={isCustom && (!deployScript || !accessUrls)}
        >
          {starting ? "Starting Installation..." : "Start Installation"}
        </Button>
      </Flex>
    </Flex>
  );
}

export default ReviewStep;
