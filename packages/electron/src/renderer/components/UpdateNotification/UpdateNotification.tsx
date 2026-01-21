/**
 * Update Notification Component
 * Shows a notification when updates are available
 */

import React, { useEffect } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  availableUpdatesAtom,
  updateCountAtom,
  showUpdateNotificationAtom,
  updateDialogOpenAtom,
  selectedAddonForUpdateAtom,
} from '../../atoms/updateAtoms';
import styles from './UpdateNotification.module.scss';

export const UpdateNotification: React.FC = () => {
  const [availableUpdates, setAvailableUpdates] = useAtom(availableUpdatesAtom);
  const updateCount = useAtomValue(updateCountAtom);
  const [showNotification, setShowNotification] = useAtom(showUpdateNotificationAtom);
  const setUpdateDialogOpen = useSetAtom(updateDialogOpenAtom);
  const setSelectedAddonForUpdate = useSetAtom(selectedAddonForUpdateAtom);

  // Listen for updates available event
  useEffect(() => {
    const handleUpdatesAvailable = (data: { count: number; updates: any[] }) => {
      setAvailableUpdates(data.updates);
      setShowNotification(true);
    };

    window.electron.update.onUpdatesAvailable(handleUpdatesAvailable);

    return () => {
      window.electron.update.removeUpdatesAvailableListener();
    };
  }, []);

  const handleUpdateClick = (addonId: string) => {
    setSelectedAddonForUpdate(addonId);
    setUpdateDialogOpen(true);
    setShowNotification(false);
  };

  const handleDismiss = () => {
    setShowNotification(false);
  };

  if (!showNotification || updateCount === 0) return null;

  return (
    <div className={styles.notification}>
      <div className={styles.header}>
        <div className={styles.icon}>🔄</div>
        <div className={styles.title}>
          <h3>Updates Available</h3>
          <p>{updateCount} addon{updateCount > 1 ? 's have' : ' has'} updates available</p>
        </div>
        <button className={styles.closeButton} onClick={handleDismiss}>
          ×
        </button>
      </div>

      <div className={styles.updates}>
        {availableUpdates
          .filter(u => u.updateAvailable)
          .map((update) => (
            <div key={update.addonId} className={styles.updateItem}>
              <div className={styles.updateInfo}>
                <span className={styles.addonName}>{update.addonName}</span>
                <span className={styles.versions}>
                  {update.currentVersion} → {update.latestVersion}
                </span>
              </div>
              <button
                className={styles.updateButton}
                onClick={() => handleUpdateClick(update.addonId)}
              >
                Update
              </button>
            </div>
          ))}
      </div>
    </div>
  );
};

