import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Profile } from '../App';

interface BackupsViewProps {
  profiles: Profile[];
  activeProfileId: string | null;
  codexRunning: boolean;
  onRestoreBackup: (backupId: string) => Promise<void>;
}

interface BackupInfo {
  id: string;
  timestamp: string;
  profile_id: string;
  profile_name: string;
  path: string;
  size_bytes: number;
}

export const BackupsView: React.FC<BackupsViewProps> = ({
  profiles,
  activeProfileId,
  codexRunning,
  onRestoreBackup
}) => {
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [deletingBackupId, setDeletingBackupId] = useState<string | null>(null);
  const [showConfirmRestore, setShowConfirmRestore] = useState<string | null>(null);
  const [showConfirmDelete, setShowConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    fetchBackups();
  }, []);

  const fetchBackups = async () => {
    setLoading(true);
    try {
      const list = await invoke<BackupInfo[]>('get_backups');
      // Sort backups by timestamp descending
      const sorted = list.sort((a, b) => b.id.localeCompare(a.id));
      setBackups(sorted);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateManualBackup = async () => {
    if (!activeProfileId) {
      alert('No active profile set. Switch to a profile first to back up its state.');
      return;
    }
    
    setCreating(true);
    try {
      // In commands.rs, we can call create_backup which runs on the active ~/.codex
      await invoke('switch_profile', { targetId: activeProfileId }); // This saves/backups current state
      await fetchBackups();
      alert('Manual backup successfully created.');
    } catch (err) {
      alert('Failed to create backup: ' + err);
    } finally {
      setCreating(false);
    }
  };

  const triggerRestore = async (backupId: string) => {
    setShowConfirmRestore(null);
    setRestoring(true);
    try {
      await onRestoreBackup(backupId);
      alert('Backup restored successfully. Codex has been updated and launched.');
      await fetchBackups();
    } catch (err) {
      alert('Failed to restore backup: ' + err);
    } finally {
      setRestoring(false);
    }
  };

  const handleDeleteBackup = async (backupId: string) => {
    setShowConfirmDelete(null);
    setDeletingBackupId(backupId);
    try {
      await invoke('delete_backup', { backupId });
      await fetchBackups();
    } catch (err) {
      alert('Failed to delete backup: ' + err);
    } finally {
      setDeletingBackupId(null);
    }
  };

  const formatTimestamp = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleString();
    } catch {
      return isoString;
    }
  };

  const getProfileName = (profileId: string) => {
    const profile = profiles.find(p => p.id === profileId);
    return profile ? profile.name : 'Unknown Profile (' + profileId.substring(0, 6) + ')';
  };

  const formatBytes = (bytes: number) => {
    if (bytes <= 0) {
      return '0 B';
    }

    const units = ['B', 'KB', 'MB', 'GB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / 1024 ** exponent;
    return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
  };

  return (
    <div className="view-container">
      
      {/* Header */}
      <div className="flex-row" style={{ justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700 }}>System Configuration Backups</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: '4px' }}>
            Restore previous database logs, conversation histories, and settings
          </p>
        </div>
        <button
          className="glow-btn"
          onClick={handleCreateManualBackup}
          disabled={creating || !activeProfileId}
        >
          {creating ? 'Saving State...' : '💾 Create Manual Backup'}
        </button>
      </div>

      {loading ? (
        <div className="glass-card flex-col" style={{ padding: '40px', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: '24px' }} className="spin-icon">⏳</div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '12px' }}>
            Scanning backups directory...
          </p>
        </div>
      ) : backups.length === 0 ? (
        <div className="glass-card flex-col" style={{ padding: '60px', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <span style={{ fontSize: '48px', marginBottom: '16px' }}>🗄️</span>
          <h3 style={{ fontSize: '16px', fontWeight: 600 }}>No Backups Found</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '6px', maxWidth: '380px' }}>
            Backups are generated automatically whenever you switch profiles to ensure you never lose databases or chat history.
          </p>
        </div>
      ) : (
        <div className="flex-col" style={{ gap: '12px' }}>
          {backups.map((backup) => (
            <div
              key={backup.id}
              className="glass-card flex-row"
              style={{
                padding: '16px 20px',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '16px',
                background: 'rgba(25, 25, 35, 0.2)',
              }}
            >
              <div className="flex-col" style={{ gap: '4px' }}>
                <div style={{ fontSize: '14px', fontWeight: 600 }}>
                  Backup: {formatTimestamp(backup.timestamp)}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Profile context: <strong style={{ color: 'var(--text-primary)' }}>{getProfileName(backup.profile_id)}</strong>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-dark)', fontFamily: 'var(--font-mono)' }}>
                  ID: {backup.id} • {formatBytes(backup.size_bytes)}
                </div>
              </div>

              <div className="flex-row" style={{ gap: '12px' }}>
                <button
                  className="glow-btn"
                  style={{ padding: '8px 16px', fontSize: '13px' }}
                  onClick={() => {
                    if (codexRunning) {
                      setShowConfirmRestore(backup.id);
                    } else {
                      triggerRestore(backup.id);
                    }
                  }}
                >
                  ⏮️ Restore State
                </button>
                <button
                  className="glow-btn glow-btn-danger"
                  style={{ padding: '8px 16px', fontSize: '13px' }}
                  onClick={() => setShowConfirmDelete(backup.id)}
                  disabled={deletingBackupId === backup.id}
                >
                  {deletingBackupId === backup.id ? 'Deleting...' : '🗑️ Remove Backup'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirmRestore && (
        <div className="modal-overlay">
          <div className="glass-panel modal-content" style={{ boxShadow: '0 0 30px rgba(255,59,48,0.15)' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '12px' }}>Confirm Backup Restore</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '24px', lineHeight: '1.5' }}>
              OpenAI Codex is currently running. We need to close it to safely override the configuration databases with this backup. 
              Are you sure you want to restore backup <strong>{showConfirmRestore}</strong>?
            </p>
            <div className="flex-row" style={{ gap: '12px', justifyContent: 'flex-end' }}>
              <button className="glow-btn" onClick={() => setShowConfirmRestore(null)}>
                Cancel
              </button>
              <button className="glow-btn glow-btn-danger" onClick={() => triggerRestore(showConfirmRestore)}>
                Close Codex & Restore
              </button>
            </div>
          </div>
        </div>
      )}

      {showConfirmDelete && (
        <div className="modal-overlay">
          <div className="glass-panel modal-content" style={{ boxShadow: '0 0 30px rgba(255,59,48,0.15)' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '12px' }}>Confirm Backup Deletion</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '24px', lineHeight: '1.5' }}>
              This will permanently remove backup <strong>{showConfirmDelete}</strong>. This action cannot be undone.
            </p>
            <div className="flex-row" style={{ gap: '12px', justifyContent: 'flex-end' }}>
              <button className="glow-btn" onClick={() => setShowConfirmDelete(null)}>
                Cancel
              </button>
              <button
                className="glow-btn glow-btn-danger"
                onClick={() => handleDeleteBackup(showConfirmDelete)}
              >
                Delete Backup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restoring Loading Overlay */}
      {restoring && (
        <div className="modal-overlay" style={{ zIndex: 2000 }}>
          <div className="glass-panel modal-content" style={{ textAlign: 'center', maxWidth: '360px', padding: '32px' }}>
            <div style={{ fontSize: '32px', marginBottom: '16px' }} className="spin-icon">⚙️</div>
            <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>Restoring System State</h3>
            <p style={{ color: 'var(--neon-blue)', fontSize: '13px', fontWeight: 500 }} className="pulse-icon">
              Overriding ~/.codex config files and restarting processes...
            </p>
          </div>
        </div>
      )}

    </div>
  );
};
