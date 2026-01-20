#!/usr/bin/env node

/**
 * Remote cleanup script - runs cleanup-pi.sh on Raspberry Pi via SSH
 * Usage: node cleanup-pi-remote.js
 */

const { NodeSSH } = require('node-ssh');
const path = require('path');
const fs = require('fs');

// SSH configuration - update these values
const SSH_CONFIG = {
  host: process.env.SSH_HOST || '192.168.0.50',
  username: process.env.SSH_USER || 'yuvalpi',
  password: process.env.SSH_PASSWORD || undefined,
  privateKeyPath: process.env.SSH_KEY_PATH || undefined,
  port: parseInt(process.env.SSH_PORT || '22', 10),
};

async function main() {
  const ssh = new NodeSSH();
  
  console.log('Connecting to Raspberry Pi...');
  console.log(`   Host: ${SSH_CONFIG.host}`);
  console.log(`   User: ${SSH_CONFIG.username}`);
  
  try {
    // Connect to SSH
    if (SSH_CONFIG.privateKeyPath && fs.existsSync(SSH_CONFIG.privateKeyPath)) {
      await ssh.connect({
        host: SSH_CONFIG.host,
        username: SSH_CONFIG.username,
        privateKeyPath: SSH_CONFIG.privateKeyPath,
        port: SSH_CONFIG.port,
      });
    } else if (SSH_CONFIG.password) {
      await ssh.connect({
        host: SSH_CONFIG.host,
        username: SSH_CONFIG.username,
        password: SSH_CONFIG.password,
        port: SSH_CONFIG.port,
      });
    } else {
      throw new Error('SSH authentication required: Set SSH_PASSWORD or SSH_KEY_PATH environment variable');
    }
    
    console.log('Connected successfully!\n');
    
    // Copy cleanup script to Pi
    const localScriptPath = path.join(__dirname, 'cleanup-pi.sh');
    const remoteScriptPath = '/tmp/cleanup-pi.sh';
    
    console.log('Uploading cleanup script...');
    await ssh.putFile(localScriptPath, remoteScriptPath);
    console.log('Script uploaded\n');
    
    // Make script executable
    console.log('Making script executable...');
    await ssh.execCommand(`chmod +x ${remoteScriptPath}`);
    console.log('Script is executable\n');
    
    // Run cleanup script
    console.log('Running cleanup script on Pi...');
    console.log('='.repeat(80));
    const result = await ssh.execCommand(`sudo bash ${remoteScriptPath}`, {
      onStdout: (chunk) => process.stdout.write(chunk.toString()),
      onStderr: (chunk) => process.stderr.write(chunk.toString()),
    });
    console.log('='.repeat(80));
    
    // Clean up remote script
    await ssh.execCommand(`rm -f ${remoteScriptPath}`);
    
    if (result.code === 0) {
      console.log('\n✅ Cleanup completed successfully!');
    } else {
      console.error(`\n❌ Cleanup script exited with code ${result.code}`);
      process.exit(1);
    }
    
    await ssh.dispose();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
