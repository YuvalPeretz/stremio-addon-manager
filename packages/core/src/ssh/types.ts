/**
 * SSH Module Types
 */

/**
 * SSH connection configuration
 */
export interface SSHConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
}

/**
 * SSH command execution result
 */
export interface SSHExecResult {
  stdout: string;
  stderr: string;
  code: number;
  signal?: string;
}

/**
 * SSH connection interface
 * This will be implemented by the SSHManager class
 */
export interface SSHConnection {
  /**
   * Execute a command on the remote system
   */
  execCommand(command: string): Promise<SSHExecResult>;

  /**
   * Execute a command with sudo privileges
   */
  execSudo(command: string): Promise<SSHExecResult>;

  /**
   * Transfer a file to the remote system
   */
  transferFile(localPath: string, remotePath: string): Promise<void>;

  /**
   * Check if connection is active
   */
  isConnected(): boolean;

  /**
   * Disconnect from the remote system
   */
  disconnect(): Promise<void>;
}

/**
 * SSH manager events
 */
export enum SSHEvent {
  CONNECTED = 'connected',
  DISCONNECTED = 'disconnected',
  ERROR = 'error',
  READY = 'ready',
}

