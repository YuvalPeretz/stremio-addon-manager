/**
 * Logging Module
 * Provides centralized logging using Winston
 */

import winston from 'winston';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/**
 * Log levels
 */
export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug',
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  level?: LogLevel;
  logToFile?: boolean;
  logDir?: string;
  logFileName?: string;
  maxFiles?: number;
  maxSize?: number;
  silent?: boolean;
}

/**
 * Default log directory
 */
const getDefaultLogDir = (): string => {
  const homeDir = os.homedir();
  return path.join(homeDir, '.stremio-addon-manager', 'logs');
};

/**
 * Ensure log directory exists
 */
const ensureLogDir = (logDir: string): void => {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
};

/**
 * Create a Winston logger instance
 */
const createLogger = (config: LoggerConfig = {}): winston.Logger => {
  const {
    level = LogLevel.INFO,
    logToFile = true,
    logDir = getDefaultLogDir(),
    logFileName = 'stremio-addon-manager.log',
    maxFiles = 7,
    maxSize = 10 * 1024 * 1024, // 10MB
    silent = false,
  } = config;

  const transports: winston.transport[] = [];

  // Console transport with colors
  transports.push(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length > 0 ? `\n${JSON.stringify(meta, null, 2)}` : '';
          return `${timestamp} [${level}]: ${message}${metaStr}`;
        })
      ),
    })
  );

  // File transport
  if (logToFile) {
    ensureLogDir(logDir);
    
    transports.push(
      new winston.transports.File({
        filename: path.join(logDir, logFileName),
        maxsize: maxSize,
        maxFiles,
        format: winston.format.combine(
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          winston.format.json()
        ),
      })
    );

    // Separate error log
    transports.push(
      new winston.transports.File({
        filename: path.join(logDir, 'error.log'),
        level: 'error',
        maxsize: maxSize,
        maxFiles,
        format: winston.format.combine(
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          winston.format.json()
        ),
      })
    );
  }

  return winston.createLogger({
    level,
    silent,
    transports,
  });
};

/**
 * Global logger instance
 */
let loggerInstance: winston.Logger;

/**
 * Initialize the logger with custom configuration
 */
export const initLogger = (config?: LoggerConfig): winston.Logger => {
  loggerInstance = createLogger(config);
  return loggerInstance;
};

/**
 * Get the logger instance
 */
export const getLogger = (): winston.Logger => {
  if (!loggerInstance) {
    loggerInstance = createLogger();
  }
  return loggerInstance;
};

/**
 * Default logger instance (auto-initialized)
 */
export const logger = {
  error: (message: string, meta?: unknown): void => {
    getLogger().error(message, meta);
  },

  warn: (message: string, meta?: unknown): void => {
    getLogger().warn(message, meta);
  },

  info: (message: string, meta?: unknown): void => {
    getLogger().info(message, meta);
  },

  debug: (message: string, meta?: unknown): void => {
    getLogger().debug(message, meta);
  },
};

/**
 * Export types
 */
export type Logger = typeof logger;

