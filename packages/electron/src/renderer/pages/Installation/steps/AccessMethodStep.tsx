/**
 * Access Method Step
 * Choose how users will access the addon
 */

import { Radio, Button, Flex, Typography, Card, Alert } from "antd";
import { FiGlobe, FiCloud, FiServer, FiHome } from "react-icons/fi";

const { Title, Text } = Typography;

interface AccessMethodStepProps {
  value: string;
  onChange: (value: string) => void;
  onNext: () => void;
  onBack: () => void;
}

function AccessMethodStep({ value, onChange, onNext, onBack }: AccessMethodStepProps) {
  const accessMethods = [
    {
      value: "custom_domain",
      icon: <FiGlobe size={32} />,
      title: "Custom Domain",
      description: "Use your own domain with HTTPS",
      requirements: ["Domain pointing to server IP", "SSL certificate (Let's Encrypt)"],
    },
    {
      value: "duckdns",
      icon: <FiCloud size={32} />,
      title: "DuckDNS",
      description: "Free Dynamic DNS with HTTPS",
      requirements: ["DuckDNS account and token", "Port forwarding (80, 443)"],
    },
    {
      value: "static_ip_domain",
      icon: <FiServer size={32} />,
      title: "Static IP + DuckDNS",
      description: "Static IP with DuckDNS domain",
      requirements: ["Static public IP", "DuckDNS account", "Port forwarding"],
    },
    {
      value: "local_network",
      icon: <FiHome size={32} />,
      title: "Local Network Only",
      description: "LAN-only access (Still requires HTTPS for Stremio)",
      requirements: ["Local network access", "Self-signed certificate or local CA"],
    },
  ];

  return (
    <Flex vertical gap={24}>
      <Flex vertical gap={8}>
        <Title level={4}>How will users access your addon?</Title>
        <Text type="secondary">
          Choose the network configuration method for your addon.
        </Text>
      </Flex>

      <Alert
        message="HTTPS is Required"
        description="Stremio requires HTTPS for addon manifests. All access methods must support SSL/HTTPS."
        type="info"
        showIcon
      />

      <Radio.Group value={value} onChange={(e) => onChange(e.target.value)} style={{ width: "100%" }}>
        <Flex vertical gap={16}>
          {accessMethods.map((method) => (
            <Card
              key={method.value}
              hoverable
              onClick={() => onChange(method.value)}
              style={{
                borderColor: value === method.value ? "#1677ff" : undefined,
                cursor: "pointer",
              }}
            >
              <Flex gap={16}>
                <Radio value={method.value} />
                <Flex align="center">{method.icon}</Flex>
                <Flex vertical gap={8} style={{ flex: 1 }}>
                  <Text strong>{method.title}</Text>
                  <Text type="secondary">{method.description}</Text>
                  <Flex vertical gap={4}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Requirements:
                    </Text>
                    {method.requirements.map((req, idx) => (
                      <Text key={idx} type="secondary" style={{ fontSize: 12 }}>
                        • {req}
                      </Text>
                    ))}
                  </Flex>
                </Flex>
              </Flex>
            </Card>
          ))}
        </Flex>
      </Radio.Group>

      <Flex justify="space-between">
        <Button onClick={onBack}>Back</Button>
        <Button type="primary" onClick={onNext} disabled={!value}>
          Next
        </Button>
      </Flex>
    </Flex>
  );
}

export default AccessMethodStep;

