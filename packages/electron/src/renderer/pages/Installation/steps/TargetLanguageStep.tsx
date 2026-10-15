/**
 * Target language for TranslatedSubtitles (single ISO 639-2/3 code).
 */

import { Button, Flex, Form, Select, Typography } from "antd";
import { DEFAULT_TARGET_LANG } from "@stremio-addon-manager/core/browser";

const { Title, Text } = Typography;

export const TARGET_LANGUAGE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "eng", label: "English (eng)" },
  { value: "heb", label: "Hebrew (heb)" },
  { value: "spa", label: "Spanish (spa)" },
  { value: "fra", label: "French (fra)" },
  { value: "deu", label: "German (deu)" },
  { value: "ita", label: "Italian (ita)" },
  { value: "por", label: "Portuguese (por)" },
  { value: "rus", label: "Russian (rus)" },
  { value: "ara", label: "Arabic (ara)" },
  { value: "jpn", label: "Japanese (jpn)" },
  { value: "kor", label: "Korean (kor)" },
  { value: "zho", label: "Chinese (zho)" },
  { value: "hin", label: "Hindi (hin)" },
  { value: "tur", label: "Turkish (tur)" },
  { value: "pol", label: "Polish (pol)" },
  { value: "nld", label: "Dutch (nld)" },
  { value: "swe", label: "Swedish (swe)" },
  { value: "nor", label: "Norwegian (nor)" },
  { value: "dan", label: "Danish (dan)" },
  { value: "fin", label: "Finnish (fin)" },
  { value: "ces", label: "Czech (ces)" },
  { value: "hun", label: "Hungarian (hun)" },
  { value: "ron", label: "Romanian (ron)" },
  { value: "ukr", label: "Ukrainian (ukr)" },
  { value: "ell", label: "Greek (ell)" },
  { value: "tha", label: "Thai (tha)" },
  { value: "vie", label: "Vietnamese (vie)" },
  { value: "ind", label: "Indonesian (ind)" },
];

interface TargetLanguageStepProps {
  value: string | null;
  onChange: (value: string) => void;
  onNext: () => void;
  onBack: () => void;
}

function TargetLanguageStep({ value, onChange, onNext, onBack }: TargetLanguageStepProps) {
  const [form] = Form.useForm<{ targetLang: string }>();

  async function handleNext(): Promise<void> {
    try {
      const values = await form.validateFields();
      onChange(values.targetLang.trim().toLowerCase());
      onNext();
    } catch {
      // validation failed
    }
  }

  return (
    <Flex vertical gap={24}>
      <Flex vertical gap={8}>
        <Title level={4}>Target language</Title>
        <Text type="secondary">
          The addon always returns one translated track in this language. Source tracks prefer English
          when available. You can change this later in Configuration.
        </Text>
      </Flex>

      <Form
        form={form}
        layout="vertical"
        initialValues={{ targetLang: value || DEFAULT_TARGET_LANG }}
      >
        <Form.Item
          label="TARGET_LANG"
          name="targetLang"
          rules={[
            { required: true, message: "Select a target language" },
            {
              pattern: /^[a-zA-Z]{2,3}$/,
              message: "Use a 2–3 letter ISO 639 code",
            },
          ]}
          extra="ISO 639-2/3 code written to ADDON_ENV as TARGET_LANG."
        >
          <Select
            showSearch
            optionFilterProp="label"
            options={TARGET_LANGUAGE_OPTIONS.map((opt) => ({
              value: opt.value,
              label: opt.label,
            }))}
          />
        </Form.Item>
      </Form>

      <Flex justify="space-between">
        <Button onClick={onBack}>Back</Button>
        <Button type="primary" onClick={() => void handleNext()}>
          Next
        </Button>
      </Flex>
    </Flex>
  );
}

export default TargetLanguageStep;
