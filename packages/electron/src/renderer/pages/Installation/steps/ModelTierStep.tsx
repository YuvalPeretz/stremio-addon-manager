/**
 * Model tier picker for TranslatedSubtitles (HW requirements next to each card).
 */

import type { ReactElement } from "react";
import { Button, Flex, Radio, Tag, Typography, Card } from "antd";
import {
  DEFAULT_LLM_MODEL_ID,
  LLM_MODEL_CATALOG,
  type LlmModelCatalogEntry,
} from "@stremio-addon-manager/core/browser";

const { Title, Text } = Typography;

interface ModelTierStepProps {
  value: string | null;
  onChange: (value: string) => void;
  onNext: () => void;
  onBack: () => void;
}

function ModelTierStep({ value, onChange, onNext, onBack }: ModelTierStepProps) {
  const selected = value || DEFAULT_LLM_MODEL_ID;

  function handleNext(): void {
    onChange(selected);
    onNext();
  }

  return (
    <Flex vertical gap={24}>
      <Flex vertical gap={8}>
        <Title level={4}>Translation model</Title>
        <Text type="secondary">
          Weights download on the target machine (not inside this app). Qwen3-1.7B is the recommended
          minimum. Ultra-light 0.6B runs on tight hosts but is experimental.
        </Text>
      </Flex>

      <Radio.Group
        value={selected}
        onChange={(e) => onChange(e.target.value as string)}
        style={{ width: "100%" }}
      >
        <Flex vertical gap={12}>
          {LLM_MODEL_CATALOG.map((entry) => (
            <ModelCard
              key={entry.id}
              entry={entry}
              selected={selected === entry.id}
              onSelect={() => onChange(entry.id)}
            />
          ))}
        </Flex>
      </Radio.Group>

      <Flex justify="space-between">
        <Button onClick={onBack}>Back</Button>
        <Button type="primary" onClick={handleNext}>
          Next
        </Button>
      </Flex>
    </Flex>
  );
}

function ModelCard({
  entry,
  selected,
  onSelect,
}: {
  entry: LlmModelCatalogEntry;
  selected: boolean;
  onSelect: () => void;
}): ReactElement {
  return (
    <Card
      hoverable
      onClick={onSelect}
      style={{
        borderColor: selected ? "#1677ff" : undefined,
        cursor: "pointer",
      }}
    >
      <Flex align="flex-start" gap={16}>
        <Radio value={entry.id} />
        <Flex vertical gap={6} style={{ flex: 1 }}>
          <Flex align="center" gap={8} wrap="wrap">
            <Text strong>{entry.label}</Text>
            <Tag>{entry.tier}</Tag>
            {entry.recommended && <Tag color="blue">Recommended minimum</Tag>}
            {entry.experimental && <Tag color="orange">Experimental</Tag>}
          </Flex>
          <Text type="secondary">
            {entry.ramBlurb} · {entry.qualityBlurb}
          </Text>
        </Flex>
      </Flex>
    </Card>
  );
}

export default ModelTierStep;
