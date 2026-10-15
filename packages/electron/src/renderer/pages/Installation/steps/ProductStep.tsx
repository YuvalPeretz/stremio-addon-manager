/**
 * Product Step — choose Streaming vs Translated Subtitles first.
 */

import { Radio, Flex, Button, Typography, Card } from "antd";
import { FiFilm, FiType } from "react-icons/fi";
import type { AddonProduct } from "@stremio-addon-manager/core";

const { Title, Text } = Typography;

interface ProductStepProps {
  value: AddonProduct;
  onChange: (value: AddonProduct) => void;
  onNext: () => void;
}

function ProductStep({ value, onChange, onNext }: ProductStepProps) {
  return (
    <Flex vertical gap={24}>
      <Flex vertical gap={8}>
        <Title level={4}>Which product do you want to install?</Title>
        <Text type="secondary">
          Both products support local, remote SSH, and custom Gateway script installs. You can install
          more than one addon.
        </Text>
      </Flex>

      <Radio.Group
        value={value}
        onChange={(e) => onChange(e.target.value as AddonProduct)}
        style={{ width: "100%" }}
      >
        <Flex vertical gap={16}>
          <Card
            hoverable
            onClick={() => onChange("streaming")}
            style={{
              borderColor: value === "streaming" ? "#1677ff" : undefined,
              cursor: "pointer",
            }}
          >
            <Flex align="center" gap={16}>
              <Radio value="streaming" />
              <FiFilm size={32} />
              <Flex vertical gap={4}>
                <Text strong>Streaming</Text>
                <Text type="secondary">
                  Private Stremio streams via Real-Debrid / TorBox. Existing addon-server product.
                </Text>
              </Flex>
            </Flex>
          </Card>

          <Card
            hoverable
            onClick={() => onChange("translated_subtitles")}
            style={{
              borderColor: value === "translated_subtitles" ? "#1677ff" : undefined,
              cursor: "pointer",
            }}
          >
            <Flex align="center" gap={16}>
              <Radio value="translated_subtitles" />
              <FiType size={32} />
              <Flex vertical gap={4}>
                <Text strong>Translated Subtitles</Text>
                <Text type="secondary">
                  OpenSubtitles proxy + local LLM translation. No Real-Debrid token. Needs RAM for the
                  selected model.
                </Text>
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

export default ProductStep;
