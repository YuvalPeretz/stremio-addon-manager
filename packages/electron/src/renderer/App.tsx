/**
 * Main Application Component
 */

import { ConfigProvider, theme } from "antd";
import { Provider as JotaiProvider } from "jotai";
import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout/Layout";
import Dashboard from "./pages/Dashboard/Dashboard";
import Installation from "./pages/Installation/Installation";
import Configuration from "./pages/Configuration/Configuration";
import ServiceControl from "./pages/ServiceControl/ServiceControl";
import Logs from "./pages/Logs/Logs";
import Connect from "./pages/Connect/Connect";
import AddonManagement from "./pages/AddonManagement/AddonManagement";
import EnvironmentVariables from "./pages/EnvironmentVariables/EnvironmentVariables";

function App() {
  return (
    <JotaiProvider>
      <ConfigProvider
        theme={{
          algorithm: theme.darkAlgorithm,
          token: {
            colorPrimary: "#1677ff",
            colorSuccess: "#52c41a",
            colorWarning: "#faad14",
            colorError: "#ff4d4f",
            colorInfo: "#1677ff",
            fontSize: 14,
            borderRadius: 8,
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
          },
          components: {
            Layout: {
              headerBg: "#1f1f1f",
              siderBg: "#141414",
              bodyBg: "#1f1f1f",
            },
            Menu: {
              darkItemBg: "#141414",
              darkItemSelectedBg: "#1677ff",
              darkItemHoverBg: "rgba(22, 119, 255, 0.2)",
            },
            Button: {
              primaryShadow: "none",
            },
          },
        }}
      >
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="connect" element={<Connect />} />
            <Route path="installation" element={<Installation />} />
            <Route path="addons" element={<AddonManagement />} />
            <Route path="configuration" element={<Configuration />} />
            <Route path="environment-variables" element={<EnvironmentVariables />} />
            <Route path="service" element={<ServiceControl />} />
            <Route path="logs" element={<Logs />} />
          </Route>
        </Routes>
      </ConfigProvider>
    </JotaiProvider>
  );
}

export default App;
