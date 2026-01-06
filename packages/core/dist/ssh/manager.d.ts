/**
 * SSH Manager
 * Handles SSH connections and remote command execution
 */
import type { SSHConfig, SSHExecResult, SSHConnection } from './types.js';
/**
 * SSH Manager class
 * Implements SSHConnection interface
 */
export declare class SSHManager implements SSHConnection {
    private ssh;
    private config;
    private connected;
    /**
     * Create a new SSHManager instance
     */
    constructor(config: SSHConfig);
    /**
     * Connect to the remote system
     */
    connect(): Promise<void>;
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
     * Transfer multiple files to the remote system
     */
    transferFiles(files: Array<{
        local: string;
        remote: string;
    }>): Promise<void>;
    /**
     * Transfer a directory to the remote system
     */
    transferDirectory(localDir: string, remoteDir: string): Promise<void>;
    /**
     * Check if connection is active
     */
    isConnected(): boolean;
    /**
     * Disconnect from the remote system
     */
    disconnect(): Promise<void>;
    /**
     * Test the SSH connection
     */
    testConnection(): Promise<boolean>;
    /**
     * Setup SSH key authentication
     * Generates a new SSH key pair and copies the public key to the remote server
     */
    static setupSSHKey(host: string, port: number, username: string, password: string): Promise<string>;
    /**
     * Create an SSH connection from configuration
     */
    static from(config: SSHConfig): Promise<SSHManager>;
}
//# sourceMappingURL=manager.d.ts.map