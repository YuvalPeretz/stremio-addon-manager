/**
 * Update Dialog Component
 * Shows update progress and allows users to update addons
 */

import React, { useEffect, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  updateDialogOpenAtom,
  selectedAddonForUpdateAtom,
  updateProgressAtom,
  updatingAddonAtom,
  updateResultAtom,
} from '../../atoms/updateAtoms';
import styles from './UpdateDialog.module.scss';

export const UpdateDialog: React.FC = () => {
  const [isOpen, setIsOpen] = useAtom(updateDialogOpenAtom);
  const [selectedAddonId, setSelectedAddonId] = useAtom(selectedAddonForUpdateAtom);
  const [updateProgress, setUpdateProgress] = useAtom(updateProgressAtom);
  const [updatingAddon, setUpdatingAddon] = useAtom(updatingAddonAtom);
  const setUpdateResult = useSetAtom(updateResultAtom);

  const [updateInfo, setUpdateInfo] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedResult, setCompletedResult] = useState<any>(null);

  // Fetch update info when dialog opens
  useEffect(() => {
    if (isOpen && selectedAddonId && !updatingAddon) {
      fetchUpdateInfo();
    }
  }, [isOpen, selectedAddonId]);

  // Listen for update progress
  useEffect(() => {
    // Check if Electron API is available (won't be in dev mode with HTTP URLs)
    if (!window.electron?.update?.onProgress) {
      console.warn('Electron update API not available (running in dev mode?)');
      return;
    }

    const handleProgress = (data: { addonId: string; progress: any }) => {
      if (data.addonId === selectedAddonId) {
        setUpdateProgress(data.progress);
      }
    };

    window.electron.update.onProgress(handleProgress);

    return () => {
      window.electron.update.removeProgressListener();
    };
  }, [selectedAddonId]);

  const fetchUpdateInfo = async () => {
    if (!selectedAddonId) return;

    if (!window.electron?.update?.check) {
      setError('Electron API not available. Please run the built app instead of dev server.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await window.electron.update.check(selectedAddonId);
      if (result.success) {
        setUpdateInfo(result.data);
      } else {
        setError(result.error || 'Failed to check for updates');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async () => {
    if (!selectedAddonId) return;

    if (!window.electron?.update?.addon) {
      setError('Electron API not available. Please run the built app instead of dev server.');
      return;
    }

    setUpdatingAddon(selectedAddonId);
    setUpdateProgress(null);
    setError(null);

    try {
      const result = await window.electron.update.addon(selectedAddonId, {
        skipBackup: false,
        restartService: true,
      });

      if (result.success) {
        setUpdateResult(result.data);
        setCompletedResult(result.data);
        // Only auto-close when there are no diagnostics errors or warnings
        const diag = result.data?.diagnostics;
        const hasIssues = diag && (diag.errors > 0 || diag.warnings > 0);
        if (!hasIssues) {
          setTimeout(() => handleClose(), 2000);
        }
      } else {
        setError(result.error || 'Update failed');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUpdatingAddon(null);
      setUpdateProgress(null);
    }
  };

  const handleClose = () => {
    if (!updatingAddon) {
      setIsOpen(false);
      setSelectedAddonId(null);
      setUpdateInfo(null);
      setUpdateProgress(null);
      setError(null);
      setCompletedResult(null);
    }
  };

  if (!isOpen) return null;

  const isUpdating = !!updatingAddon;
  const canUpdate = updateInfo?.updateAvailable && !isUpdating;

  const statusIcon = (status: string) => {
    if (status === 'ok') return '✓';
    if (status === 'warning') return '⚠';
    return '✗';
  };
  const statusClass = (status: string) => {
    if (status === 'ok') return styles.diagOk;
    if (status === 'warning') return styles.diagWarn;
    return styles.diagError;
  };

  return (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Update Addon</h2>
          {!isUpdating && (
            <button className={styles.closeButton} onClick={handleClose}>
              ×
            </button>
          )}
        </div>

        <div className={styles.content}>
          {loading && (
            <div className={styles.loading}>
              <div className={styles.spinner} />
              <p>Checking for updates...</p>
            </div>
          )}

          {error && (
            <div className={styles.error}>
              <p>❌ {error}</p>
            </div>
          )}

          {updateInfo && !isUpdating && !error && (
            <div className={styles.updateInfo}>
              <div className={styles.versions}>
                <div className={styles.versionItem}>
                  <span className={styles.label}>Current Version:</span>
                  <span className={styles.value}>{updateInfo.currentVersion}</span>
                </div>
                <div className={styles.versionItem}>
                  <span className={styles.label}>Latest Version:</span>
                  <span className={styles.value}>{updateInfo.latestVersion}</span>
                </div>
              </div>

              {updateInfo.updateAvailable ? (
                <div className={styles.updateAvailable}>
                  <p className={styles.successMessage}>✓ Update available!</p>
                  {updateInfo.changes && updateInfo.changes.length > 0 && (
                    <div className={styles.changes}>
                      <h4>Changes:</h4>
                      <ul>
                        {updateInfo.changes.map((change: string, index: number) => (
                          <li key={index}>{change}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className={styles.warnings}>
                    <p>⚠️ Service will be restarted</p>
                    <p>ℹ️ Backup will be created automatically</p>
                  </div>
                </div>
              ) : (
                <div className={styles.upToDate}>
                  <p className={styles.successMessage}>✓ Already on latest version</p>
                </div>
              )}
            </div>
          )}

          {isUpdating && (
            <div className={styles.updating}>
              <div className={styles.progressContainer}>
                <div className={styles.spinner} />
                <h3>Updating...</h3>

                {updateProgress && (
                  <div className={styles.progressDetails}>
                    <p className={styles.stepMessage}>{updateProgress.message}</p>
                    <div className={styles.progressBar}>
                      <div
                        className={styles.progressFill}
                        style={{ width: `${updateProgress.progress}%` }}
                      />
                    </div>
                    <p className={styles.stepStatus}>
                      {updateProgress.status === 'in_progress' && '⏳'}
                      {updateProgress.status === 'completed' && '✓'}
                      {updateProgress.status === 'failed' && '❌'}
                      {updateProgress.status === 'skipped' && '⊘'}
                      {' '}
                      {updateProgress.step}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {completedResult && !isUpdating && (
            <div className={styles.diagnosticsPanel}>
              <h3>
                {completedResult.diagnostics?.errors > 0
                  ? '❌ Update complete — issues found'
                  : completedResult.diagnostics?.warnings > 0
                  ? '⚠️ Update complete — warnings'
                  : '✅ Update complete'}
              </h3>

              {completedResult.diagnostics?.checks?.length > 0 && (
                <div className={styles.diagChecks}>
                  {(completedResult.diagnostics.checks as Array<{ check: string; status: string; message: string; autoFixed?: boolean }>)
                    .filter((c) => c.status !== 'ok')
                    .map((c, i) => (
                      <div key={i} className={`${styles.diagItem} ${statusClass(c.status)}`}>
                        <span className={styles.diagIcon}>{statusIcon(c.status)}</span>
                        <span className={styles.diagMsg}>
                          {c.message}
                          {c.autoFixed && <em> (auto-fixed)</em>}
                        </span>
                      </div>
                    ))}
                  {(completedResult.diagnostics.checks as Array<{ status: string }>).filter((c) => c.status !== 'ok').length === 0 && (
                    <p className={styles.allOk}>All checks passed.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className={styles.footer}>
          {!isUpdating && !completedResult && (
            <>
              <button className={styles.cancelButton} onClick={handleClose}>
                Cancel
              </button>
              <button
                className={styles.updateButton}
                onClick={handleUpdate}
                disabled={!canUpdate || loading}
              >
                Update Now
              </button>
            </>
          )}
          {!isUpdating && completedResult && (
            <button className={styles.cancelButton} onClick={handleClose}>
              Close
            </button>
          )}
          {isUpdating && (
            <p className={styles.updatingNote}>Please wait while the addon is being updated...</p>
          )}
        </div>
      </div>
    </div>
  );
};

