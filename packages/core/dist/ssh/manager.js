/**
 * SSH Manager
 * Handles SSH connections and remote command execution
 */
import { NodeSSH } from 'node-ssh';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { logger } from '../utils/logger.js';
/**
 * SSH Manager class
 * Implements SSHConnection interface
 */
export class SSHManager {
    ssh;
    config;
    connected = false;
    /**
     * Create a new SSHManager instance
     */
    constructor(config) {
        this.ssh = new NodeSSH();
        this.config = config;
    }
    /**
     * Connect to the remote system
     */
    async connect() {
        try {
            logger.info('Connecting to SSH server', {
                host: this.config.host,
                port: this.config.port,
                username: this.config.username,
            });
            await this.ssh.connect({
                host: this.config.host,
                port: this.config.port,
                username: this.config.username,
                password: this.config.password,
                privateKey: this.config.privateKeyPath,
                passphrase: this.config.passphrase,
                tryKeyboard: true,
            });
            this.connected = true;
            logger.info('SSH connection established');
        }
        catch (error) {
            this.connected = false;
            logger.error('SSH connection failed', error);
            throw new Error(`SSH connection failed: ${error.message}`);
        }
    }
    /**
     * Execute a command on the remote system
     */
    async execCommand(command) {
        if (!this.connected) {
            throw new Error('Not connected. Call connect() first.');
        }
        try {
            logger.debug('Executing command', { command });
            const result = await this.ssh.execCommand(command);
            logger.debug('Command completed', {
                command,
                code: result.code,
                hasStdout: result.stdout.length > 0,
                hasStderr: result.stderr.length > 0,
            });
            return {
                stdout: result.stdout,
                stderr: result.stderr,
                code: result.code ?? 0,
                signal: result.signal ?? undefined,
            };
        }
        catch (error) {
            logger.error('Command execution failed', { command, error });
            throw new Error(`Command execution failed: ${error.message}`);
        }
    }
    /**
     * Execute a command with sudo privileges
     */
    async execSudo(command) {
        if (!this.connected) {
            throw new Error('Not connected. Call connect() first.');
        }
        try {
            logger.debug('Executing sudo command', { command });
            // Use sudo with -S flag to read password from stdin
            const sudoCommand = `sudo -S ${command}`;
            const result = await this.ssh.execCommand(sudoCommand);
            logger.debug('Sudo command completed', {
                command,
                code: result.code,
            });
            return {
                stdout: result.stdout,
                stderr: result.stderr,
                code: result.code ?? 0,
                signal: result.signal ?? undefined,
            };
        }
        catch (error) {
            logger.error('Sudo command execution failed', { command, error });
            throw new Error(`Sudo command execution failed: ${error.message}`);
        }
    }
    /**
     * Transfer a file to the remote system
     */
    async transferFile(localPath, remotePath) {
        if (!this.connected) {
            throw new Error('Not connected. Call connect() first.');
        }
        try {
            logger.info('Transferring file', { localPath, remotePath });
            await this.ssh.putFile(localPath, remotePath);
            logger.info('File transfer completed');
        }
        catch (error) {
            logger.error('File transfer failed', { localPath, remotePath, error });
            throw new Error(`File transfer failed: ${error.message}`);
        }
    }
    /**
     * Transfer multiple files to the remote system
     */
    async transferFiles(files) {
        if (!this.connected) {
            throw new Error('Not connected. Call connect() first.');
        }
        try {
            logger.info('Transferring multiple files', { count: files.length });
            await this.ssh.putFiles(files);
            logger.info('Multiple file transfer completed');
        }
        catch (error) {
            logger.error('Multiple file transfer failed', error);
            throw new Error(`Multiple file transfer failed: ${error.message}`);
        }
    }
    /**
     * Transfer a directory to the remote system
     */
    async transferDirectory(localDir, remoteDir) {
        if (!this.connected) {
            throw new Error('Not connected. Call connect() first.');
        }
        try {
            logger.info('Transferring directory', { localDir, remoteDir });
            await this.ssh.putDirectory(localDir, remoteDir, {
                recursive: true,
                concurrency: 5,
            });
            logger.info('Directory transfer completed');
        }
        catch (error) {
            logger.error('Directory transfer failed', { localDir, remoteDir, error });
            throw new Error(`Directory transfer failed: ${error.message}`);
        }
    }
    /**
     * Check if connection is active
     */
    isConnected() {
        return this.connected;
    }
    /**
     * Disconnect from the remote system
     */
    async disconnect() {
        if (this.connected) {
            this.ssh.dispose();
            this.connected = false;
            logger.info('SSH connection closed');
        }
    }
    /**
     * Test the SSH connection
     */
    async testConnection() {
        try {
            await this.connect();
            const result = await this.execCommand('echo "Connection successful"');
            await this.disconnect();
            return result.code === 0;
        }
        catch {
            return false;
        }
    }
    /**
     * Setup SSH key authentication
     * Generates a new SSH key pair and copies the public key to the remote server
     */
    static async setupSSHKey(host, port, username, password) {
        const homeDir = os.homedir();
        const sshDir = path.join(homeDir, '.ssh');
        const keyPath = path.join(sshDir, 'stremio_addon_key');
        const pubKeyPath = `${keyPath}.pub`;
        try {
            // Ensure .ssh directory exists
            await fs.mkdir(sshDir, { recursive: true, mode: 0o700 });
            // Generate SSH key pair (if it doesn't exist)
            const keyExists = await fs.access(keyPath).then(() => true).catch(() => false);
            if (!keyExists) {
                logger.info('Generating SSH key pair', { keyPath });
                // Use ssh-keygen to generate the key
                const { exec } = await import('node:child_process');
                const { promisify } = await import('node:util');
                const execAsync = promisify(exec);
                await execAsync(`ssh-keygen -t ed25519 -f "${keyPath}" -N "" -C "stremio-addon-manager"`);
                logger.info('SSH key pair generated');
            }
            else {
                logger.info('SSH key pair already exists', { keyPath });
            }
            // Read public key
            const publicKey = await fs.readFile(pubKeyPath, 'utf-8');
            // Connect with password and add public key to authorized_keys
            const tempSSH = new SSHManager({ host, port, username, password });
            await tempSSH.connect();
            logger.info('Adding public key to authorized_keys');
            await tempSSH.execCommand('mkdir -p ~/.ssh && chmod 700 ~/.ssh');
            await tempSSH.execCommand(`echo "${publicKey.trim()}" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`);
            await tempSSH.disconnect();
            logger.info('SSH key setup completed');
            return keyPath;
        }
        catch (error) {
            logger.error('SSH key setup failed', error);
            throw new Error(`SSH key setup failed: ${error.message}`);
        }
    }
    /**
     * Create an SSH connection from configuration
     */
    static async from(config) {
        const manager = new SSHManager(config);
        await manager.connect();
        return manager;
    }
}
//# sourceMappingURL=manager.js.map