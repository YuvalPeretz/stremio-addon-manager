/**
 * Logs Command
 * View addon service logs
 */
interface LogsOptions {
    lines?: string;
    follow?: boolean;
    remote?: boolean;
}
/**
 * Logs command handler
 */
export declare function logsCommand(options: LogsOptions): Promise<void>;
export {};
//# sourceMappingURL=logs.d.ts.map