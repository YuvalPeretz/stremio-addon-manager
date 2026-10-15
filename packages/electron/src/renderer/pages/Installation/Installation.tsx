/**
 * Installation Page
 * Multi-step installation wizard for setting up the addon
 */

import { useState } from "react";
import { Steps, Card, Flex, Typography, Button, Result, Alert } from "antd";
import { useAtom, useSetAtom } from "jotai";
import type { AddonProduct } from "@stremio-addon-manager/core";
import {
  DEFAULT_ADDON_PRODUCT,
  DEFAULT_LLM_MODEL_ID,
  DEFAULT_TARGET_LANG,
} from "@stremio-addon-manager/core/browser";
import {
  isInstallingAtom,
  installationResultAtom,
  installationErrorAtom,
  installationProgressAtom,
} from "../../atoms/installationAtoms";
import ProductStep from "./steps/ProductStep";
import InstallationTypeStep, { type WizardInstallationType } from "./steps/InstallationTypeStep";
import SSHConfigStep from "./steps/SSHConfigStep";
import AddonConfigStep from "./steps/AddonConfigStep";
import ProvidersStep, { type ProvidersStepValue } from "./steps/ProvidersStep";
import TargetLanguageStep from "./steps/TargetLanguageStep";
import ModelTierStep from "./steps/ModelTierStep";
import AccessMethodStep from "./steps/AccessMethodStep";
import FeaturesStep from "./steps/FeaturesStep";
import DeployScriptStep, { type DeployScriptStepValue } from "./steps/DeployScriptStep";
import AccessUrlsStep, { type AccessUrlsStepValue } from "./steps/AccessUrlsStep";
import ReviewStep from "./steps/ReviewStep";
import InstallationProgress from "./components/InstallationProgress";
import styles from "./Installation.module.scss";

const { Title, Text } = Typography;

type WizardStepId =
  | "product"
  | "installType"
  | "ssh"
  | "addonConfig"
  | "providers"
  | "targetLang"
  | "modelTier"
  | "deployScript"
  | "accessUrls"
  | "accessMethod"
  | "features"
  | "review";

interface ProvidersConfigValue {
  realDebridToken?: string;
  torboxToken?: string;
  streamProviderMode?: string;
  streamProviderOrder?: string[];
  provider?: string;
}

function toProvidersStepValue(value: ProvidersConfigValue | null): ProvidersStepValue | null {
  if (!value) return null;
  return {
    realDebridToken: value.realDebridToken,
    torboxToken: value.torboxToken ?? "",
    streamProviderMode: value.streamProviderMode === "ordered" ? "ordered" : "parallel",
    streamProviderOrder: value.streamProviderOrder ?? [],
    provider: value.provider,
  };
}

const STEP_META: Record<WizardStepId, { title: string; description: string }> = {
  product: { title: "Product", description: "Streaming or subtitles" },
  installType: { title: "Installation Type", description: "Local, remote, or script" },
  ssh: { title: "SSH Configuration", description: "Remote Server Access" },
  addonConfig: { title: "Addon Configuration", description: "Basic Settings" },
  providers: { title: "Stream Providers", description: "Configure Sources" },
  targetLang: { title: "Target Language", description: "ISO subtitle language" },
  modelTier: { title: "Model Tier", description: "Local LLM + hardware" },
  deployScript: { title: "Deploy Script", description: "Script & artifacts" },
  accessUrls: { title: "Access URLs", description: "Public + admin" },
  accessMethod: { title: "Access Method", description: "Network Configuration" },
  features: { title: "Features", description: "Select Features" },
  review: { title: "Review", description: "Confirm Settings" },
};

function wizardStepIds(product: AddonProduct, type: WizardInstallationType): WizardStepId[] {
  const ids: WizardStepId[] = ["product", "installType"];
  if (type === "remote") {
    ids.push("ssh");
  }
  ids.push("addonConfig");
  if (product === "translated_subtitles") {
    ids.push("targetLang", "modelTier");
  } else {
    ids.push("providers");
  }
  if (type === "custom_script") {
    ids.push("deployScript", "accessUrls");
  } else {
    ids.push("accessMethod", "features");
  }
  ids.push("review");
  return ids;
}

function Installation() {
  const [currentStep, setCurrentStep] = useState(0);
  const [product, setProduct] = useState<AddonProduct>(DEFAULT_ADDON_PRODUCT);
  const [installationType, setInstallationType] = useState<WizardInstallationType>("local");
  const [sshConfig, setSSHConfig] = useState<Record<string, unknown> | null>(null);
  const [addonConfig, setAddonConfig] = useState<Record<string, unknown> | null>(null);
  const [providersConfig, setProvidersConfig] = useState<ProvidersConfigValue | null>(null);
  const [targetLang, setTargetLang] = useState<string>(DEFAULT_TARGET_LANG);
  const [llmModelId, setLlmModelId] = useState<string>(DEFAULT_LLM_MODEL_ID);
  const [accessMethod, setAccessMethod] = useState<string>("");
  const [features, setFeatures] = useState<Record<string, unknown> | null>(null);
  const [deployScript, setDeployScript] = useState<DeployScriptStepValue | null>(null);
  const [accessUrls, setAccessUrls] = useState<AccessUrlsStepValue | null>(null);

  const [isInstalling] = useAtom(isInstallingAtom);
  const [installationResult] = useAtom(installationResultAtom);
  const [installationError] = useAtom(installationErrorAtom);
  const setInstallationResult = useSetAtom(installationResultAtom);
  const setInstallationError = useSetAtom(installationErrorAtom);
  const setInstallationProgress = useSetAtom(installationProgressAtom);

  const isCustom = installationType === "custom_script";
  const isRemote = installationType === "remote";
  const stepIds = wizardStepIds(product, installationType);
  const currentStepId = stepIds[currentStep] ?? "product";

  function returnToWizard(step: number): void {
    setInstallationResult(null);
    setInstallationError(null);
    setInstallationProgress([]);
    setCurrentStep(step);
  }

  function handleFailureBack(): void {
    if (isCustom) {
      const deployIdx = stepIds.indexOf("deployScript");
      returnToWizard(deployIdx >= 0 ? deployIdx : 0);
      return;
    }
    const reviewIdx = stepIds.indexOf("review");
    returnToWizard(reviewIdx >= 0 ? reviewIdx : 0);
  }

  function handleFailureRetry(): void {
    const reviewIdx = stepIds.indexOf("review");
    returnToWizard(reviewIdx >= 0 ? reviewIdx : 0);
  }

  function handleFailureStartOver(): void {
    returnToWizard(0);
  }

  function handleNext(): void {
    setCurrentStep((s) => Math.min(s + 1, stepIds.length - 1));
  }

  function handleBack(): void {
    setCurrentStep((s) => Math.max(s - 1, 0));
  }

  function handleProductChange(next: AddonProduct): void {
    setProduct(next);
    setCurrentStep(0);
  }

  function handleInstallationTypeChange(type: WizardInstallationType): void {
    setInstallationType(type);
    const nextIds = wizardStepIds(product, type);
    const typeIdx = nextIds.indexOf("installType");
    setCurrentStep(typeIdx >= 0 ? typeIdx : 1);
  }

  function renderStep() {
    switch (currentStepId) {
      case "product":
        return <ProductStep value={product} onChange={handleProductChange} onNext={handleNext} />;
      case "installType":
        return (
          <InstallationTypeStep
            value={installationType}
            onChange={handleInstallationTypeChange}
            onNext={handleNext}
            onBack={handleBack}
          />
        );
      case "ssh":
        return <SSHConfigStep value={sshConfig} onChange={setSSHConfig} onNext={handleNext} onBack={handleBack} />;
      case "addonConfig":
        return (
          <AddonConfigStep
            value={addonConfig}
            onChange={setAddonConfig}
            onNext={handleNext}
            onBack={handleBack}
            installationType={installationType}
            product={product}
          />
        );
      case "providers":
        return (
          <ProvidersStep
            value={toProvidersStepValue(providersConfig)}
            onChange={(next) => setProvidersConfig(next)}
            onNext={handleNext}
            onBack={handleBack}
            addonConfig={addonConfig}
            installationType={installationType}
          />
        );
      case "targetLang":
        return (
          <TargetLanguageStep
            value={targetLang}
            onChange={setTargetLang}
            onNext={handleNext}
            onBack={handleBack}
          />
        );
      case "modelTier":
        return (
          <ModelTierStep value={llmModelId} onChange={setLlmModelId} onNext={handleNext} onBack={handleBack} />
        );
      case "deployScript":
        return (
          <DeployScriptStep
            value={deployScript}
            onChange={setDeployScript}
            onNext={handleNext}
            onBack={handleBack}
            product={product}
          />
        );
      case "accessUrls":
        return (
          <AccessUrlsStep
            value={accessUrls}
            onChange={setAccessUrls}
            onNext={handleNext}
            onBack={handleBack}
            product={product}
          />
        );
      case "accessMethod":
        return (
          <AccessMethodStep value={accessMethod} onChange={setAccessMethod} onNext={handleNext} onBack={handleBack} />
        );
      case "features":
        return (
          <FeaturesStep
            value={features}
            onChange={setFeatures}
            onNext={handleNext}
            onBack={handleBack}
            product={product}
          />
        );
      case "review":
        return (
          <ReviewStep
            product={product}
            installationType={installationType}
            sshConfig={sshConfig}
            addonConfig={addonConfig}
            providersConfig={providersConfig as Record<string, unknown> | null}
            targetLang={targetLang}
            llmModelId={llmModelId}
            accessMethod={accessMethod}
            features={features}
            deployScript={deployScript}
            accessUrls={accessUrls}
            onBack={handleBack}
          />
        );
      default:
        return null;
    }
  }

  if (isInstalling) {
    return (
      <Flex vertical gap={24} className={styles.installation}>
        <Title level={2}>Installing Addon</Title>
        <InstallationProgress />
      </Flex>
    );
  }

  if (installationResult) {
    if (installationResult.success) {
      return (
        <Flex vertical gap={24} className={styles.installation}>
          <Result
            status="success"
            title="Installation Complete!"
            subTitle="Your Stremio addon has been successfully installed and configured."
            extra={[
              installationResult.warning ? (
                <Alert
                  key="mgmt-warning"
                  type="warning"
                  showIcon
                  style={{ maxWidth: 720, textAlign: "left" }}
                  message="Private admin managementUrl not verified"
                  description={installationResult.warning}
                />
              ) : null,
              <Card key="urls" className={styles.urlCard}>
                <Flex vertical gap={16}>
                  <Flex vertical gap={8}>
                    <Text strong>Addon URL</Text>
                    <Text copyable code>
                      {installationResult.addonUrl}
                    </Text>
                  </Flex>
                  <Flex vertical gap={8}>
                    <Text strong>Install in Stremio</Text>
                    <Text copyable code>
                      {installationResult.installManifestUrl}
                    </Text>
                    <Text type="secondary">Copy this URL and paste it in Stremio to install your addon</Text>
                  </Flex>
                </Flex>
              </Card>,
              <Button key="dashboard" type="primary" onClick={() => (window.location.href = "/#/dashboard")}>
                Go to Dashboard
              </Button>,
            ]}
          />
        </Flex>
      );
    }

    const errorText = installationError || "An unknown error occurred during installation.";
    const isUnhealthyUrl = /not healthy|URL not healthy/i.test(errorText);
    const scriptOutputSplit = errorText.split("--- script output ---");
    const summary = scriptOutputSplit[0]?.trim() || errorText;
    const scriptTail = scriptOutputSplit[1]?.trim();

    return (
      <Flex vertical gap={24} className={styles.installation}>
        <Result
          status="error"
          title="Installation Failed"
          subTitle={
            isUnhealthyUrl
              ? "Deploy script exited 0 but the public URL never became healthy. Check the URL, Gateway app, and script output below."
              : summary.slice(0, 280) + (summary.length > 280 ? "…" : "")
          }
          extra={[
            <Card key="error-detail" style={{ maxWidth: 720, textAlign: "left" }}>
              <Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
                Error detail
              </Text>
              <pre
                style={{
                  margin: 0,
                  maxHeight: 220,
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontSize: 12,
                }}
              >
                {summary}
              </pre>
              {scriptTail && (
                <>
                  <Text type="secondary" style={{ display: "block", marginTop: 16, marginBottom: 8 }}>
                    Script stdout/stderr (tail)
                  </Text>
                  <pre
                    style={{
                      margin: 0,
                      maxHeight: 280,
                      overflow: "auto",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      fontSize: 12,
                      background: "rgba(0,0,0,0.04)",
                      padding: 12,
                    }}
                  >
                    {scriptTail}
                  </pre>
                </>
              )}
            </Card>,
            <Button key="back" type="primary" onClick={handleFailureBack}>
              Back
            </Button>,
            <Button key="retry" onClick={handleFailureRetry}>
              Retry
            </Button>,
            <Button key="start-over" onClick={handleFailureStartOver}>
              Start over
            </Button>,
            <Button key="dashboard" onClick={() => (window.location.href = "/#/dashboard")}>
              Go to Dashboard
            </Button>,
          ]}
        />
      </Flex>
    );
  }

  return (
    <Flex vertical gap={24} className={styles.installation}>
      <Title level={2}>Installation Wizard</Title>
      <Steps current={currentStep} items={stepIds.map((id) => STEP_META[id])} />
      <Card>{renderStep()}</Card>
    </Flex>
  );
}

export default Installation;
