/**
 * Config Command
 * Manage addon configuration
 */
interface ConfigOptions {
    show?: boolean;
    edit?: boolean;
    set?: string;
    get?: string;
    reset?: boolean;
}
/**
 * Config command handler
 */
export declare function configCommand(options: ConfigOptions): Promise<void>;
export {};
//# sourceMappingURL=config.d.ts.map