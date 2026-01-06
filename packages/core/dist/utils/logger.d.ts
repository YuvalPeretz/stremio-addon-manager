/**
 * Logging Module
 * Provides centralized logging using Winston
 */
import winston from 'winston';
/**
 * Log levels
 */
export declare enum LogLevel {
    ERROR = "error",
    WARN = "warn",
    INFO = "info",
    DEBUG = "debug"
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
 * Initialize the logger with custom configuration
 */
export declare const initLogger: (config?: LoggerConfig) => winston.Logger;
/**
 * Get the logger instance
 */
export declare const getLogger: () => winston.Logger;
/**
 * Default logger instance (auto-initialized)
 */
export declare const logger: {
    error: (message: string, meta?: unknown) => void;
    warn: (message: string, meta?: unknown) => void;
    info: (message: string, meta?: unknown) => void;
    debug: (message: string, meta?: unknown) => void;
};
/**
 * Export types
 */
export type Logger = typeof logger;
//# sourceMappingURL=logger.d.ts.map