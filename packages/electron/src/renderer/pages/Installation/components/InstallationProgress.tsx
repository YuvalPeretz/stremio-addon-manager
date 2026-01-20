/**
 * Installation Progress Component
 * Displays real-time installation progress
 */

import { useEffect } from "react";
import { Card, Progress, Timeline, Flex, Typography, Tag } from "antd";
import { FiCheck, FiX, FiLoader, FiClock, FiSkipForward } from "react-icons/fi";
import { useAtom } from "jotai";
import {
  installationProgressAtom,
  latestInstallationProgressAtom,
} from "../../../atoms/installationAtoms";
import styles from "./InstallationProgress.module.scss";

const { Text, Title } = Typography;

function InstallationProgress() {
  const [progressUpdates, setProgressUpdates] = useAtom(installationProgressAtom);
  const [latestProgress] = useAtom(latestInstallationProgressAtom);

  useEffect(() => {
    // Subscribe to installation progress events
    window.electron.install.onProgress((progress: any) => {
      setProgressUpdates((prev) => {
        // Find if this step already exists in the updates
        const existingIndex = prev.findIndex((update) => update.step === progress.step);
        
        if (existingIndex >= 0) {
          // Replace the existing step update instead of appending
          const updated = [...prev];
          updated[existingIndex] = progress;
          return updated;
        } else {
          // New step, append it
          return [...prev, progress];
        }
      });
    });

    return () => {
      window.electron.install.removeProgressListener();
    };
  }, []);

  function getStepIcon(status: string) {
    switch (status) {
      case "completed":
        return <FiCheck size={16} style={{ color: "#52c41a" }} />;
      case "failed":
        return <FiX size={16} style={{ color: "#ff4d4f" }} />;
      case "in_progress":
        return <FiLoader size={16} className={styles.spinning} style={{ color: "#1677ff" }} />;
      case "skipped":
        return <FiSkipForward size={16} style={{ color: "#8c8c8c" }} />;
      default:
        return <FiClock size={16} style={{ color: "#8c8c8c" }} />;
    }
  }

  function getStepColor(status: string) {
    switch (status) {
      case "completed":
        return "green";
      case "failed":
        return "red";
      case "in_progress":
        return "blue";
      case "skipped":
        return "default";
      default:
        return "default";
    }
  }

  const progressPercent = latestProgress?.progress || 0;

  return (
    <Flex vertical gap={24}>
      <Card>
        <Flex vertical gap={16}>
          <Flex justify="space-between" align="center">
            <Title level={4} style={{ margin: 0 }}>
              Installation Progress
            </Title>
            <Text strong>{progressPercent}%</Text>
          </Flex>
          <Progress
            percent={progressPercent}
            status={latestProgress?.status === "failed" ? "exception" : "active"}
            strokeColor="#1677ff"
          />
          {latestProgress && (
            <Text type="secondary">{latestProgress.message}</Text>
          )}
        </Flex>
      </Card>

      <Card title="Installation Steps">
        <Timeline
          items={progressUpdates.map((update) => ({
            dot: getStepIcon(update.status),
            color: getStepColor(update.status),
            children: (
              <Flex vertical gap={8}>
                <Flex align="center" gap={8}>
                  <Text strong>{update.step.replace(/_/g, " ").toUpperCase()}</Text>
                  <Tag color={getStepColor(update.status)}>
                    {update.status.toUpperCase()}
                  </Tag>
                </Flex>
                <Text type="secondary">{update.message}</Text>
                {update.error && (
                  <Text type="danger" style={{ fontSize: 12 }}>
                    Error: {update.error.message}
                  </Text>
                )}
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {new Date(update.timestamp).toLocaleTimeString()}
                </Text>
              </Flex>
            ),
          }))}
        />
      </Card>
    </Flex>
  );
}

export default InstallationProgress;

