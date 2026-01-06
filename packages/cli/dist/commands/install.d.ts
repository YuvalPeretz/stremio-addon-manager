/**
 * Install Command
 * Handles the installation flow for the Stremio addon
 */
interface InstallOptions {
    remote?: boolean;
    config?: string;
    skipSsl?: boolean;
}
/**
 * Install command handler
 */
export declare function installCommand(options: InstallOptions): Promise<void>;
export {};
//# sourceMappingURL=install.d.ts.map