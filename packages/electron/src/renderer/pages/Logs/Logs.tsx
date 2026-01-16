/**
 * Logs Page
 * View and manage addon service logs
 */

import { useState, useEffect, useRef } from "react";
import { useAtom } from "jotai";
import {
  Card,
  Flex,
  Typography,
  Button,
  Input,
  Select,
  Switch,
  Space,
  message,
  Modal,
  Tag,
} from "antd";
import {
  FiDownload,
  FiCopy,
  FiTrash2,
  FiRotateCw,
  FiSearch,
} from "react-icons/fi";
import { serviceLogsAtom } from "../../atoms/serviceAtoms";
import styles from "./Logs.module.scss";

const { Title, Text } = Typography;
const { Search } = Input;

type LogLevel = "all" | "info" | "warn" | "error" | "debug";

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

function Logs() {
  const [logs, setLogs] = useAtom(serviceLogsAtom);
  const [loading, setLoading] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [logLevel, setLogLevel] = useState<LogLevel>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [parsedLogs, setParsedLogs] = useState<LogEntry[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadLogs();
    // Poll logs every 5 seconds
    const interval = setInterval(loadLogs, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [parsedLogs, autoScroll]);

  useEffect(() => {
    // Parse logs into structured format
    if (logs) {
      const entries = logs.split("\n").filter(Boolean).map((line) => {
        // Try to parse JSON logs or plain text
        try {
          const parsed = JSON.parse(line);
          return {
            timestamp: parsed.timestamp || new Date().toISOString(),
            level: parsed.level || "info",
            message: parsed.message || line,
          };
        } catch {
          // Plain text log
          const match = line.match(/^\[(\d{4}-\d{2}-\d{2}T[\d:.-]+Z?)\]\s*\[(\w+)\]\s*(.+)$/);
          if (match) {
            return {
              timestamp: match[1],
              level: match[2].toLowerCase(),
              message: match[3],
            };
          }
          return {
            timestamp: new Date().toISOString(),
            level: "info",
            message: line,
          };
        }
      });
      setParsedLogs(entries);
    }
  }, [logs]);

  async function loadLogs() {
    setLoading(true);
    const result = await window.electron.service.getLogs();
    setLoading(false);

    if (result.success && result.data) {
      setLogs(result.data as string);
    }
  }

  function handleCopyLogs() {
    if (logs) {
      navigator.clipboard.writeText(logs);
      message.success("Logs copied to clipboard");
    } else {
      message.warning("No logs to copy");
    }
  }

  function handleDownloadLogs() {
    if (logs) {
      const blob = new Blob([logs], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `stremio-addon-logs-${new Date().toISOString()}.txt`;
      link.click();
      URL.revokeObjectURL(url);
      message.success("Logs downloaded");
    } else {
      message.warning("No logs to download");
    }
  }

  function handleClearLogs() {
    Modal.confirm({
      title: "Clear Logs",
      content: "Are you sure you want to clear all logs? This action cannot be undone.",
      okText: "Clear",
      okType: "danger",
      onOk: async () => {
        const result = await window.electron.service.clearLogs();
        if (result.success) {
          setLogs("");
          setParsedLogs([]);
          message.success("Logs cleared successfully");
        } else {
          message.error("Failed to clear logs");
        }
      },
    });
  }

  function getFilteredLogs(): LogEntry[] {
    let filtered = parsedLogs;

    // Filter by log level
    if (logLevel !== "all") {
      filtered = filtered.filter((entry) => entry.level === logLevel);
    }

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (entry) =>
          entry.message.toLowerCase().includes(query) ||
          entry.level.toLowerCase().includes(query) ||
          entry.timestamp.toLowerCase().includes(query)
      );
    }

    return filtered;
  }

  function getLevelColor(level: string): string {
    switch (level.toLowerCase()) {
      case "error":
        return "error";
      case "warn":
      case "warning":
        return "warning";
      case "info":
        return "processing";
      case "debug":
        return "default";
      default:
        return "default";
    }
  }

  function formatTimestamp(timestamp: string): string {
    try {
      const date = new Date(timestamp);
      return date.toLocaleString();
    } catch {
      return timestamp;
    }
  }

  const filteredLogs = getFilteredLogs();

  return (
    <Flex vertical gap={24} className={styles.logs}>
      <Flex justify="space-between" align="center">
        <Title level={2}>Service Logs</Title>
        <Space>
          <Text type="secondary">Auto-scroll:</Text>
          <Switch checked={autoScroll} onChange={setAutoScroll} />
          <Button icon={<FiRotateCw className={loading ? styles.spinning : ""} />} onClick={loadLogs} disabled={loading}>
            Refresh
          </Button>
        </Space>
      </Flex>

      {/* Filters and Actions */}
      <Card>
        <Flex justify="space-between" align="center" wrap="wrap" gap={16}>
          <Space size="middle">
            <Search
              placeholder="Search logs..."
              prefix={<FiSearch />}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: 300 }}
              allowClear
            />
            <Select
              value={logLevel}
              onChange={setLogLevel}
              style={{ width: 120 }}
              options={[
                { value: "all", label: "All Levels" },
                { value: "info", label: "Info" },
                { value: "warn", label: "Warning" },
                { value: "error", label: "Error" },
                { value: "debug", label: "Debug" },
              ]}
            />
          </Space>
          <Space>
            <Button icon={<FiCopy />} onClick={handleCopyLogs}>
              Copy
            </Button>
            <Button icon={<FiDownload />} onClick={handleDownloadLogs}>
              Download
            </Button>
            <Button danger icon={<FiTrash2 />} onClick={handleClearLogs}>
              Clear
            </Button>
          </Space>
        </Flex>
      </Card>

      {/* Logs Display */}
      <Card
        title={
          <Flex justify="space-between" align="center">
            <Text>
              Showing {filteredLogs.length} of {parsedLogs.length} log entries
            </Text>
          </Flex>
        }
      >
        <div className={styles.logsContainer} ref={logsContainerRef}>
          {filteredLogs.length === 0 ? (
            <div className={styles.emptyLogs}>
              <Text type="secondary">No logs to display</Text>
            </div>
          ) : (
            <div className={styles.logsList}>
              {filteredLogs.map((entry, index) => (
                <div key={index} className={styles.logEntry}>
                  <Flex gap={8} align="flex-start">
                    <Tag color={getLevelColor(entry.level)} className={styles.logLevel}>
                      {entry.level.toUpperCase()}
                    </Tag>
                    <Text type="secondary" className={styles.logTimestamp}>
                      {formatTimestamp(entry.timestamp)}
                    </Text>
                    <Text className={styles.logMessage}>{entry.message}</Text>
                  </Flex>
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          )}
        </div>
      </Card>
    </Flex>
  );
}

export default Logs;
