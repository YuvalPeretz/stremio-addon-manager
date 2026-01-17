/**
 * Main Layout Component
 * Provides the application shell with sidebar navigation
 */

import { Layout as AntLayout, Menu, Flex, Typography } from 'antd';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  FiHome,
  FiDownload,
  FiSettings,
  FiPlay,
  FiFileText,
  FiServer,
  FiGrid,
} from 'react-icons/fi';
import AddonSelector from '../AddonSelector/AddonSelector';
import styles from './Layout.module.scss';

const { Header, Sider, Content } = AntLayout;
const { Title } = Typography;

function Layout() {
  const navigate = useNavigate();
  const location = useLocation();

  const menuItems = [
    {
      key: '/dashboard',
      icon: <FiHome size={18} />,
      label: 'Dashboard',
    },
    {
      key: '/addons',
      icon: <FiGrid size={18} />,
      label: 'Addon Management',
    },
    {
      key: '/connect',
      icon: <FiServer size={18} />,
      label: 'Connect to Server',
    },
    {
      key: '/installation',
      icon: <FiDownload size={18} />,
      label: 'Installation',
    },
    {
      key: '/service',
      icon: <FiPlay size={18} />,
      label: 'Service Control',
    },
    {
      key: '/configuration',
      icon: <FiSettings size={18} />,
      label: 'Configuration',
    },
    {
      key: '/logs',
      icon: <FiFileText size={18} />,
      label: 'Logs',
    },
  ];

  function handleMenuClick({ key }: { key: string }) {
    navigate(key);
  }

  return (
    <AntLayout className={styles.layout}>
      <Header className={styles.header}>
        <Flex align="center" justify="space-between" style={{ width: '100%' }}>
          <Title level={4} style={{ margin: 0, color: 'white' }}>
            🎬 Stremio Addon Manager
          </Title>
          <AddonSelector />
        </Flex>
      </Header>
      <AntLayout>
        <Sider width={240} className={styles.sider}>
          <Menu
            mode="inline"
            selectedKeys={[location.pathname]}
            items={menuItems}
            onClick={handleMenuClick}
            theme="dark"
          />
        </Sider>
        <Content className={styles.content}>
          <Outlet />
        </Content>
      </AntLayout>
    </AntLayout>
  );
}

export default Layout;

