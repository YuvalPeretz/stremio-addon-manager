/**
 * Installation Type Step
 * Choose between local, remote, or custom script installation
 */

import { Radio, Flex, Button, Typography, Card } from "antd";
import { FiMonitor, FiServer, FiCode } from "react-icons/fi";

const { Title, Text } = Typography;

export type WizardInstallationType = "local" | "remote" | "custom_script";

interface InstallationTypeStepProps {
  value: WizardInstallationType;
  onChange: (value: WizardInstallationType) => void;
  onNext: () => void;
  onBack?: () => void;
}

function InstallationTypeStep({ value, onChange, onNext, onBack }: InstallationTypeStepProps) {
  return (
    <Flex vertical gap={24}>
      <Flex vertical gap={8}>
        <Title level={4}>Where would you like to install the addon?</Title>
        <Text type="secondary">
          Choose local, remote SSH, or a custom Gateway deploy script (dual public + private apps).
        </Text>
      </Flex>

      <Radio.Group
        value={value}
        onChange={(e) => onChange(e.target.value as WizardInstallationType)}
        style={{ width: "100%" }}
      >
        <Flex vertical gap={16}>
          <Card
            hoverable
            onClick={() => onChange("local")}
            style={{
              borderColor: value === "local" ? "#1677ff" : undefined,
              cursor: "pointer",
            }}
          >
            <Flex align="center" gap={16}>
              <Radio value="local" />
              <FiMonitor size={32} />
              <Flex vertical gap={4}>
                <Text strong>Local Installation</Text>
                <Text type="secondary">Install on this computer</Text>
              </Flex>
            </Flex>
          </Card>

          <Card
            hoverable
            onClick={() => onChange("remote")}
            style={{
              borderColor: value === "remote" ? "#1677ff" : undefined,
              cursor: "pointer",
            }}
          >
            <Flex align="center" gap={16}>
              <Radio value="remote" />
              <FiServer size={32} />
              <Flex vertical gap={4}>
                <Text strong>Remote Installation</Text>
                <Text type="secondary">Install on a remote server via SSH</Text>
              </Flex>
            </Flex>
          </Card>

          <Card
            hoverable
            onClick={() => onChange("custom_script")}
            style={{
              borderColor: value === "custom_script" ? "#1677ff" : undefined,
              cursor: "pointer",
            }}
          >
            <Flex align="center" gap={16}>
              <Radio value="custom_script" />
              <FiCode size={32} />
              <Flex vertical gap={4}>
                <Text strong>Custom script</Text>
                <Text type="secondary">
                  Dual Gateway apps — you run a deploy script with staged ADDON + ADMIN builds
                </Text>
              </Flex>
            </Flex>
          </Card>
        </Flex>
      </Radio.Group>

      <Flex justify="space-between">
        {onBack ? <Button onClick={onBack}>Back</Button> : <span />}
        <Button type="primary" onClick={onNext}>
          Next
        </Button>
      </Flex>
    </Flex>
  );
}

export default InstallationTypeStep;
