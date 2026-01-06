/**
 * Uninstall Command
 * Remove the addon and all files
 */
interface UninstallOptions {
    remote?: boolean;
    keepConfig?: boolean;
    keepBackups?: boolean;
}
/**
 * Uninstall command handler
 */
export declare function uninstallCommand(options: UninstallOptions): Promise<void>;
export {};
//# sourceMappingURL=uninstall.d.ts.map