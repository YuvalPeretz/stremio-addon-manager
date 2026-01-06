/**
 * Installation Module Types
 */
/**
 * Installation step
 */
export var InstallationStep;
(function (InstallationStep) {
    InstallationStep["CONNECT"] = "connect";
    InstallationStep["DETECT_OS"] = "detect_os";
    InstallationStep["CHECK_PREREQUISITES"] = "check_prerequisites";
    InstallationStep["INSTALL_PREREQUISITES"] = "install_prerequisites";
    InstallationStep["SETUP_FIREWALL"] = "setup_firewall";
    InstallationStep["SETUP_FAIL2BAN"] = "setup_fail2ban";
    InstallationStep["CLONE_REPOSITORY"] = "clone_repository";
    InstallationStep["INSTALL_DEPENDENCIES"] = "install_dependencies";
    InstallationStep["SETUP_NGINX"] = "setup_nginx";
    InstallationStep["SETUP_SSL"] = "setup_ssl";
    InstallationStep["CREATE_SERVICE"] = "create_service";
    InstallationStep["START_SERVICE"] = "start_service";
    InstallationStep["CONFIGURE_DUCKDNS"] = "configure_duckdns";
    InstallationStep["CREATE_BACKUP"] = "create_backup";
    InstallationStep["VERIFY_INSTALLATION"] = "verify_installation";
    InstallationStep["CLEANUP"] = "cleanup";
    InstallationStep["COMPLETE"] = "complete";
})(InstallationStep || (InstallationStep = {}));
/**
 * Installation step status
 */
export var StepStatus;
(function (StepStatus) {
    StepStatus["PENDING"] = "pending";
    StepStatus["IN_PROGRESS"] = "in_progress";
    StepStatus["COMPLETED"] = "completed";
    StepStatus["FAILED"] = "failed";
    StepStatus["SKIPPED"] = "skipped";
})(StepStatus || (StepStatus = {}));
//# sourceMappingURL=types.js.map