/**
 * Installation Type Step
 * Choose between local or remote installation
 */

import { Radio, Flex, Button, Typography, Card } from "antd";
import { FiMonitor, FiServer } from "react-icons/fi";

const { Title, Text } = Typography;

interface InstallationTypeStepProps {
  value: "local" | "remote";
  onChange: (value: "local" | "remote") => void;
  onNext: () => void;
}

function InstallationTypeStep({ value, onChange, onNext }: InstallationTypeStepProps) {
  return (
    <Flex vertical gap={24}>
      <Flex vertical gap={8}>
        <Title level={4}>Where would you like to install the addon?</Title>
        <Text type="secondary">
          Choose whether to install on this computer or on a remote server via SSH.
        </Text>
      </Flex>

      <Radio.Group
        value={value}
        onChange={(e) => onChange(e.target.value)}
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
        </Flex>
      </Radio.Group>

      <Flex justify="flex-end">
        <Button type="primary" onClick={onNext}>
          Next
        </Button>
      </Flex>
    </Flex>
  );
}

export default InstallationTypeStep;

