/**
 * SSH Configuration Step
 * Configure SSH connection for remote installation
 */

import { useState } from "react";
import { Form, Input, InputNumber, Radio, Button, Flex, Typography, Alert } from "antd";
import { FiCheck, FiX } from "react-icons/fi";

const { Title, Text } = Typography;

interface SSHConfigStepProps {
  value: any;
  onChange: (value: any) => void;
  onNext: () => void;
  onBack: () => void;
}

function SSHConfigStep({ value, onChange, onNext, onBack }: SSHConfigStepProps) {
  const [form] = Form.useForm();
  const [authMethod, setAuthMethod] = useState<"password" | "key">("password");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<boolean | null>(null);

  async function handleTest() {
    try {
      await form.validateFields();
      const values = form.getFieldsValue();

      setTesting(true);
      setTestResult(null);

      const sshConfig = {
        host: values.host,
        port: values.port,
        username: values.username,
        ...(authMethod === "password"
          ? { password: values.password }
          : { privateKeyPath: values.privateKeyPath }),
      };

      const result = await window.electron.ssh.test(sshConfig);

      setTestResult(result.success && result.data === true);
      if (result.success && result.data === true) {
        onChange(sshConfig);
      }
    } catch (error) {
      setTestResult(false);
    } finally {
      setTesting(false);
    }
  }

  async function handleNext() {
    try {
      await form.validateFields();
      const values = form.getFieldsValue();

      const sshConfig = {
        host: values.host,
        port: values.port,
        username: values.username,
        ...(authMethod === "password"
          ? { password: values.password }
          : { privateKeyPath: values.privateKeyPath }),
      };

      onChange(sshConfig);
      onNext();
    } catch (error) {
      // Validation failed
    }
  }

  return (
    <Flex vertical gap={24}>
      <Flex vertical gap={8}>
        <Title level={4}>Configure SSH Connection</Title>
        <Text type="secondary">
          Enter the SSH credentials to connect to your remote server.
        </Text>
      </Flex>

      <Form form={form} layout="vertical" initialValues={{ port: 22, ...value }}>
        <Form.Item
          label="Host"
          name="host"
          rules={[{ required: true, message: "Please enter the host" }]}
        >
          <Input placeholder="192.168.0.50 or example.com" />
        </Form.Item>

        <Form.Item
          label="Port"
          name="port"
          rules={[{ required: true, message: "Please enter the port" }]}
        >
          <InputNumber min={1} max={65535} style={{ width: "100%" }} />
        </Form.Item>

        <Form.Item
          label="Username"
          name="username"
          rules={[{ required: true, message: "Please enter the username" }]}
        >
          <Input placeholder="root or pi" />
        </Form.Item>

        <Form.Item label="Authentication Method">
          <Radio.Group value={authMethod} onChange={(e) => setAuthMethod(e.target.value)}>
            <Radio value="password">Password</Radio>
            <Radio value="key">Private Key</Radio>
          </Radio.Group>
        </Form.Item>

        {authMethod === "password" ? (
          <Form.Item
            label="Password"
            name="password"
            rules={[{ required: true, message: "Please enter the password" }]}
          >
            <Input.Password placeholder="Enter password" />
          </Form.Item>
        ) : (
          <Form.Item
            label="Private Key Path"
            name="privateKeyPath"
            rules={[{ required: true, message: "Please enter the private key path" }]}
          >
            <Input placeholder="~/.ssh/id_rsa" />
          </Form.Item>
        )}

        <Form.Item>
          <Button onClick={handleTest} loading={testing} block>
            {testing ? "Testing Connection..." : "Test Connection"}
          </Button>
        </Form.Item>
      </Form>

      {testResult !== null && (
        <Alert
          message={testResult ? "Connection Successful" : "Connection Failed"}
          description={
            testResult
              ? "SSH connection established successfully"
              : "Unable to connect. Please check your credentials."
          }
          type={testResult ? "success" : "error"}
          showIcon
          icon={testResult ? <FiCheck /> : <FiX />}
        />
      )}

      <Flex justify="space-between">
        <Button onClick={onBack}>Back</Button>
        <Button type="primary" onClick={handleNext} disabled={testResult !== true}>
          Next
        </Button>
      </Flex>
    </Flex>
  );
}

export default SSHConfigStep;

