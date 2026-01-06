/**
 * Configuration Module Types
 */
/**
 * Access method for the addon
 */
export var AccessMethod;
(function (AccessMethod) {
    AccessMethod["CUSTOM_DOMAIN"] = "custom_domain";
    AccessMethod["DUCKDNS"] = "duckdns";
    AccessMethod["STATIC_IP_WITH_DOMAIN"] = "static_ip_domain";
    AccessMethod["LOCAL_NETWORK"] = "local_network";
})(AccessMethod || (AccessMethod = {}));
/**
 * Installation type
 */
export var InstallationType;
(function (InstallationType) {
    InstallationType["LOCAL"] = "local";
    InstallationType["REMOTE"] = "remote";
})(InstallationType || (InstallationType = {}));
/**
 * Provider type
 */
export var Provider;
(function (Provider) {
    Provider["REAL_DEBRID"] = "real-debrid";
    Provider["ALL_DEBRID"] = "alldebrid";
    Provider["PREMIUMIZE"] = "premiumize";
    Provider["TORBOX"] = "torbox";
})(Provider || (Provider = {}));
/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = {
    addon: {
        name: 'My_Private_Addon',
        version: '1.0.0',
        domain: '',
        password: '',
        provider: Provider.REAL_DEBRID,
        torrentLimit: 15,
        port: 7000,
    },
    features: {
        firewall: true,
        fail2ban: true,
        caching: {
            enabled: true,
            ttl: 7200, // 2 hours
            maxSize: 100, // 100MB
        },
        rateLimiting: {
            enabled: true,
            stream: 50,
            stats: 120,
        },
        authentication: true,
        backups: {
            enabled: true,
            frequency: 'weekly',
            retention: 7,
        },
        ssl: true,
        duckdnsUpdater: false,
        autoStart: true,
    },
};
//# sourceMappingURL=types.js.map