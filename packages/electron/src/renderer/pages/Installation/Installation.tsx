/**
 * Installation Page
 * Multi-step installation wizard for setting up the addon
 */

import { useState } from "react";
import { Steps, Card, Flex, Typography, Button, Result } from "antd";
import { useAtom } from "jotai";
import { isInstallingAtom, installationResultAtom, installationErrorAtom } from "../../atoms/installationAtoms";
import InstallationTypeStep from "./steps/InstallationTypeStep";
import SSHConfigStep from "./steps/SSHConfigStep";
import AddonConfigStep from "./steps/AddonConfigStep";
import AccessMethodStep from "./steps/AccessMethodStep";
import FeaturesStep from "./steps/FeaturesStep";
import ReviewStep from "./steps/ReviewStep";
import InstallationProgress from "./components/InstallationProgress";
import styles from "./Installation.module.scss";

const { Title, Text } = Typography;

function Installation() {
  const [currentStep, setCurrentStep] = useState(0);
  const [installationType, setInstallationType] = useState<"local" | "remote">("local");
  const [sshConfig, setSSHConfig] = useState<any>(null);
  const [addonConfig, setAddonConfig] = useState<any>(null);
  const [accessMethod, setAccessMethod] = useState<string>("");
  const [features, setFeatures] = useState<any>(null);

  const [isInstalling] = useAtom(isInstallingAtom);
  const [installationResult] = useAtom(installationResultAtom);
  const [installationError] = useAtom(installationErrorAtom);

  const steps = [
    {
      title: "Installation Type",
      description: "Local or Remote",
    },
    ...(installationType === "remote"
      ? [
          {
            title: "SSH Configuration",
            description: "Remote Server Access",
          },
        ]
      : []),
    {
      title: "Addon Configuration",
      description: "Basic Settings",
    },
    {
      title: "Access Method",
      description: "Network Configuration",
    },
    {
      title: "Features",
      description: "Select Features",
    },
    {
      title: "Review",
      description: "Confirm Settings",
    },
  ];

  function handleNext() {
    setCurrentStep(currentStep + 1);
  }

  function handleBack() {
    setCurrentStep(currentStep - 1);
  }

  function handleInstallationTypeChange(type: "local" | "remote") {
    setInstallationType(type);
  }

  function renderStep() {
    // Adjust step index for remote installation
    const adjustedStep = installationType === "remote" ? currentStep : currentStep === 0 ? 0 : currentStep + 1;

    switch (adjustedStep) {
      case 0:
        return (
          <InstallationTypeStep value={installationType} onChange={handleInstallationTypeChange} onNext={handleNext} />
        );
      case 1:
        if (installationType === "remote") {
          return <SSHConfigStep value={sshConfig} onChange={setSSHConfig} onNext={handleNext} onBack={handleBack} />;
        }
        return (
          <AddonConfigStep value={addonConfig} onChange={setAddonConfig} onNext={handleNext} onBack={handleBack} />
        );
      case 2:
        return (
          <AddonConfigStep value={addonConfig} onChange={setAddonConfig} onNext={handleNext} onBack={handleBack} />
        );
      case 3:
        return (
          <AccessMethodStep value={accessMethod} onChange={setAccessMethod} onNext={handleNext} onBack={handleBack} />
        );
      case 4:
        return <FeaturesStep value={features} onChange={setFeatures} onNext={handleNext} onBack={handleBack} />;
      case 5:
        return (
          <ReviewStep
            installationType={installationType}
            sshConfig={sshConfig}
            addonConfig={addonConfig}
            accessMethod={accessMethod}
            features={features}
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
    } else {
      return (
        <Flex vertical gap={24} className={styles.installation}>
          <Result
            status="error"
            title="Installation Failed"
            subTitle={installationError || "An unknown error occurred during installation."}
            extra={[
              <Button key="retry" type="primary" onClick={() => window.location.reload()}>
                Try Again
              </Button>,
              <Button key="dashboard" onClick={() => (window.location.href = "/#/dashboard")}>
                Go to Dashboard
              </Button>,
            ]}
          />
        </Flex>
      );
    }
  }

  return (
    <Flex vertical gap={24} className={styles.installation}>
      <Title level={2}>Installation Wizard</Title>

      <Card>
        <Flex vertical gap={24}>
          <Steps current={currentStep} items={steps} />
          <div className={styles.stepContent}>{renderStep()}</div>
        </Flex>
      </Card>
    </Flex>
  );
}

export default Installation;
