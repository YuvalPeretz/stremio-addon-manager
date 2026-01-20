/**
 * Features Step
 * Select which features to enable
 */

import { Form, Switch, Button, Flex, Typography, Card, InputNumber, Select, Input } from "antd";

const { Title, Text } = Typography;

interface FeaturesStepProps {
  value: any;
  onChange: (value: any) => void;
  onNext: () => void;
  onBack: () => void;
}

function FeaturesStep({ value, onChange, onNext, onBack }: FeaturesStepProps) {
  const [form] = Form.useForm();

  async function handleNext() {
    try {
      await form.validateFields();
      const values = form.getFieldsValue();

      const features = {
        firewall: values.firewall,
        fail2ban: values.fail2ban,
        caching: {
          enabled: values.cachingEnabled,
          ttl: values.cachingTtl || 7200,
          maxSize: values.cachingMaxSize || 100,
        },
        rateLimiting: {
          enabled: values.rateLimitingEnabled,
          stream: values.rateLimitingStream || 50,
          stats: values.rateLimitingStats || 120,
        },
        authentication: values.authentication,
        backups: {
          enabled: values.backupsEnabled,
          frequency: values.backupsFrequency || "weekly",
          retention: values.backupsRetention || 7,
        },
        ssl: true, // Always true
        sslEmail: values.sslEmail, // Email for Let's Encrypt
        duckdnsUpdater: values.duckdnsUpdater,
        autoStart: values.autoStart,
      };

      onChange(features);
      onNext();
    } catch (error) {
      // Validation failed
    }
  }

  return (
    <Flex vertical gap={24}>
      <Flex vertical gap={8}>
        <Title level={4}>Select Features</Title>
        <Text type="secondary">
          Choose which features you want to enable for your addon.
        </Text>
      </Flex>

      <Form
        form={form}
        layout="vertical"
        initialValues={{
          firewall: true,
          fail2ban: true,
          cachingEnabled: true,
          cachingTtl: 7200,
          cachingMaxSize: 100,
          rateLimitingEnabled: true,
          rateLimitingStream: 50,
          rateLimitingStats: 120,
          authentication: true,
          backupsEnabled: true,
          backupsFrequency: "weekly",
          backupsRetention: 7,
          sslEmail: value?.sslEmail || "",
          duckdnsUpdater: false,
          autoStart: true,
          ...value,
        }}
      >
        <Card title="Security" size="small">
          <Flex vertical gap={16}>
            <Flex justify="space-between" align="center">
              <Flex vertical gap={4}>
                <Text strong>Firewall (UFW)</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Configure firewall rules for incoming connections
                </Text>
              </Flex>
              <Form.Item name="firewall" valuePropName="checked" noStyle>
                <Switch />
              </Form.Item>
            </Flex>

            <Flex justify="space-between" align="center">
              <Flex vertical gap={4}>
                <Text strong>fail2ban</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Protect SSH from brute-force attacks
                </Text>
              </Flex>
              <Form.Item name="fail2ban" valuePropName="checked" noStyle>
                <Switch />
              </Form.Item>
            </Flex>

            <Flex justify="space-between" align="center">
              <Flex vertical gap={4}>
                <Text strong>Password Authentication</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Require password for addon access
                </Text>
              </Flex>
              <Form.Item name="authentication" valuePropName="checked" noStyle>
                <Switch />
              </Form.Item>
            </Flex>
          </Flex>
        </Card>

        <Card title="Performance" size="small">
          <Flex vertical gap={16}>
            <Flex justify="space-between" align="center">
              <Flex vertical gap={4}>
                <Text strong>Caching</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Cache search results and metadata
                </Text>
              </Flex>
              <Form.Item name="cachingEnabled" valuePropName="checked" noStyle>
                <Switch />
              </Form.Item>
            </Flex>

            <Form.Item noStyle shouldUpdate>
              {({ getFieldValue }) =>
                getFieldValue("cachingEnabled") && (
                  <Flex vertical gap={8}>
                    <Form.Item label="Cache TTL (seconds)" name="cachingTtl">
                      <InputNumber min={300} max={86400} style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item label="Cache Max Size (MB)" name="cachingMaxSize">
                      <InputNumber min={10} max={1000} style={{ width: "100%" }} />
                    </Form.Item>
                  </Flex>
                )
              }
            </Form.Item>

            <Flex justify="space-between" align="center">
              <Flex vertical gap={4}>
                <Text strong>Rate Limiting</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Limit requests to protect APIs
                </Text>
              </Flex>
              <Form.Item name="rateLimitingEnabled" valuePropName="checked" noStyle>
                <Switch />
              </Form.Item>
            </Flex>

            <Form.Item noStyle shouldUpdate>
              {({ getFieldValue }) =>
                getFieldValue("rateLimitingEnabled") && (
                  <Flex vertical gap={8}>
                    <Form.Item label="Stream Requests (per 15 min)" name="rateLimitingStream">
                      <InputNumber min={10} max={200} style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item label="Stats Requests (per min)" name="rateLimitingStats">
                      <InputNumber min={10} max={500} style={{ width: "100%" }} />
                    </Form.Item>
                  </Flex>
                )
              }
            </Form.Item>
          </Flex>
        </Card>

        <Card title="SSL/HTTPS" size="small">
          <Flex vertical gap={16}>
            <Form.Item
              label="Email Address for SSL Certificate"
              name="sslEmail"
              rules={[
                { required: true, message: "Email address is required for Let's Encrypt certificate registration" },
                { type: "email", message: "Please enter a valid email address" },
              ]}
              help="This email will be used for Let's Encrypt certificate registration and renewal notifications"
            >
              <Input type="email" placeholder="your-email@example.com" />
            </Form.Item>
          </Flex>
        </Card>

        <Card title="Maintenance" size="small">
          <Flex vertical gap={16}>
            <Flex justify="space-between" align="center">
              <Flex vertical gap={4}>
                <Text strong>Automatic Backups</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Create periodic backups of addon configuration
                </Text>
              </Flex>
              <Form.Item name="backupsEnabled" valuePropName="checked" noStyle>
                <Switch />
              </Form.Item>
            </Flex>

            <Form.Item noStyle shouldUpdate>
              {({ getFieldValue }) =>
                getFieldValue("backupsEnabled") && (
                  <Flex vertical gap={8}>
                    <Form.Item label="Backup Frequency" name="backupsFrequency">
                      <Select>
                        <Select.Option value="daily">Daily</Select.Option>
                        <Select.Option value="weekly">Weekly</Select.Option>
                        <Select.Option value="monthly">Monthly</Select.Option>
                      </Select>
                    </Form.Item>
                    <Form.Item label="Retention (days)" name="backupsRetention">
                      <InputNumber min={1} max={90} style={{ width: "100%" }} />
                    </Form.Item>
                  </Flex>
                )
              }
            </Form.Item>

            <Flex justify="space-between" align="center">
              <Flex vertical gap={4}>
                <Text strong>DuckDNS Updater</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Automatically update DuckDNS IP address
                </Text>
              </Flex>
              <Form.Item name="duckdnsUpdater" valuePropName="checked" noStyle>
                <Switch />
              </Form.Item>
            </Flex>

            <Flex justify="space-between" align="center">
              <Flex vertical gap={4}>
                <Text strong>Auto-start on Boot</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Start addon service automatically on system boot
                </Text>
              </Flex>
              <Form.Item name="autoStart" valuePropName="checked" noStyle>
                <Switch />
              </Form.Item>
            </Flex>
          </Flex>
        </Card>
      </Form>

      <Flex justify="space-between">
        <Button onClick={onBack}>Back</Button>
        <Button type="primary" onClick={handleNext}>
          Next
        </Button>
      </Flex>
    </Flex>
  );
}

export default FeaturesStep;

