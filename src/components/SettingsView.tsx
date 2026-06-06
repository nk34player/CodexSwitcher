import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface SettingsViewProps {
  codexAppPath: string | null;
  appLockEnabled: boolean;
  onUpdatePath: (path: string | null) => Promise<void>;
  onUpdateAppLock: (enabled: boolean, passcode?: string) => Promise<void>;
  onPanicReset: () => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  codexAppPath,
  appLockEnabled,
  onUpdatePath,
  onUpdateAppLock,
  onPanicReset
}) => {
  const [pathInput, setPathInput] = useState(codexAppPath || '');
  const [detectedPath, setDetectedPath] = useState('');
  const [passcode, setPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [verifyPasscode, setVerifyPasscode] = useState('');
  const [showPasscodeForm, setShowPasscodeForm] = useState(false);
  const [showDisableForm, setShowDisableForm] = useState(false);
  const [showPanicModal, setShowPanicModal] = useState(false);
  const [panicInput, setPanicInput] = useState('');
  const [error, setError] = useState('');
  const [savingPath, setSavingPath] = useState(false);
  const [savingLock, setSavingLock] = useState(false);
  const [panicExecuting, setPanicExecuting] = useState(false);
  
  const [configDirPath, setConfigDirPath] = useState<string>('');

  useEffect(() => {
    setPathInput(codexAppPath || detectedPath || '');
  }, [codexAppPath, detectedPath]);

  useEffect(() => {
    const fetchConfigDir = async () => {
      try {
        const path = await invoke<string>('get_app_config_dir_path');
        setConfigDirPath(path);
      } catch (err) {
        console.error('Failed to get config path:', err);
      }
    };
    fetchConfigDir();
  }, []);

  useEffect(() => {
    const fetchDetectedPath = async () => {
      try {
        const path = await invoke<string>('get_detected_codex_app_path');
        setDetectedPath(path);
      } catch (err) {
        console.error('Failed to detect Codex path:', err);
      }
    };
    fetchDetectedPath();
  }, []);

  const handleOpenConfigDir = async () => {
    try {
      await invoke('open_app_config_dir');
    } catch (err) {
      alert('Failed to open configuration folder: ' + err);
    }
  };

  const handleCopyPath = () => {
    if (configDirPath) {
      navigator.clipboard.writeText(configDirPath);
      alert('Configuration folder path copied to clipboard!');
    }
  };

  const handleSavePath = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPath(true);
    try {
      const pathValue = pathInput.trim() ? pathInput.trim() : null;
      await onUpdatePath(pathValue);
      alert('Application path settings successfully updated.');
    } catch (err) {
      alert('Failed to update path: ' + err);
    } finally {
      setSavingPath(false);
    }
  };

  const handleResetPath = async () => {
    setSavingPath(true);
    try {
      setPathInput('');
      await onUpdatePath(null);
      alert('Application path reset to default auto-detection.');
    } catch (err) {
      alert('Failed to reset path: ' + err);
    } finally {
      setSavingPath(false);
    }
  };

  const handleEnableLock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passcode.length < 4) {
      setError('Passcode must be at least 4 characters/digits.');
      return;
    }
    if (passcode !== confirmPasscode) {
      setError('Passcodes do not match.');
      return;
    }

    setSavingLock(true);
    setError('');
    try {
      await onUpdateAppLock(true, passcode);
      alert('App Lock passcode enabled.');
      setShowPasscodeForm(false);
      setPasscode('');
      setConfirmPasscode('');
    } catch (err) {
      setError(String(err));
    } finally {
      setSavingLock(false);
    }
  };

  const handleDisableLock = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingLock(true);
    setError('');
    try {
      const isValid = await invoke<boolean>('verify_app_lock', { password: verifyPasscode });
      if (isValid) {
        await onUpdateAppLock(false);
        alert('App Lock passcode disabled.');
        setShowDisableForm(false);
        setVerifyPasscode('');
      } else {
        setError('Incorrect passcode verification failed.');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setSavingLock(false);
    }
  };

  const triggerPanicReset = async () => {
    if (panicInput !== 'PANIC') return;
    
    setPanicExecuting(true);
    try {
      await onPanicReset();
      alert('Panic Reset Complete. Application data deleted. Restarting...');
      window.location.reload();
    } catch (err) {
      alert('Panic Reset failed: ' + err);
    } finally {
      setPanicExecuting(false);
      setShowPanicModal(false);
    }
  };

  return (
    <div className="view-container" style={{ gap: '32px' }}>
      
      {/* Header */}
      <div>
        <h1 style={{ fontSize: '24px', fontWeight: 700 }}>Application Settings</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: '4px' }}>
          Configure paths, adjust app lock parameters, or perform system resets
        </p>
      </div>

      {/* Path Setting */}
      <div className="glass-card" style={{ padding: '24px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>Codex Executable Path</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '20px' }}>
          Specify a custom path to the OpenAI Codex desktop application. If left empty, the system will auto-detect the standard install directory.
        </p>

        <form onSubmit={handleSavePath} className="flex-col" style={{ gap: '16px' }}>
          <div className="input-group" style={{ margin: 0 }}>
            <span className="input-label">Absolute Executable / Application Path</span>
            <input
              type="text"
              className="input-field"
              placeholder="/Applications/Codex.app or C:\Program Files\Codex\Codex.exe"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
            />
          </div>

          <div className="flex-row" style={{ gap: '12px', flexWrap: 'wrap' }}>
            <button type="submit" className="glow-btn glow-btn-primary" disabled={savingPath}>
              {savingPath ? 'Saving Path...' : 'Save Configuration'}
            </button>
            {codexAppPath && (
              <button type="button" className="glow-btn" onClick={handleResetPath} disabled={savingPath}>
                Reset to Default Auto-detection
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Configuration Folder */}
      <div className="glass-card" style={{ padding: '24px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>Application Configuration Folder</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '20px' }}>
          CodexSwitcher configuration data, database profiles, and historical backups are stored securely in this directory.
        </p>

        <div className="flex-col" style={{ gap: '16px' }}>
          <div 
            style={{ 
              background: 'rgba(0, 0, 0, 0.2)', 
              padding: '12px 16px', 
              borderRadius: '8px', 
              border: '1px solid var(--border-color)',
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: '13px',
              color: 'var(--text-primary)',
              wordBreak: 'break-all',
              userSelect: 'all'
            }}
          >
            {configDirPath || 'Retrieving path...'}
          </div>

          <div className="flex-row" style={{ gap: '12px', flexWrap: 'wrap' }}>
            <button type="button" className="glow-btn glow-btn-primary" onClick={handleOpenConfigDir} disabled={!configDirPath}>
              📂 Open Folder
            </button>
            <button type="button" className="glow-btn" onClick={handleCopyPath} disabled={!configDirPath}>
              📋 Copy Path
            </button>
          </div>
        </div>
      </div>

      {/* App Lock Settings */}
      <div className="glass-card" style={{ padding: '24px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>Security & App Lock</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '20px' }}>
          Protect your active profiles and switched configuration states with a secure passcode verified against the system Keychain.
        </p>

        {appLockEnabled ? (
          <div className="flex-col" style={{ gap: '12px', alignItems: 'flex-start' }}>
            <div className="flex-row" style={{ gap: '8px' }}>
              <span style={{ color: '#34c759', fontSize: '18px' }}>🛡️</span>
              <span style={{ fontSize: '14px', fontWeight: 600 }}>App Lock is currently enabled</span>
            </div>
            
            {!showDisableForm ? (
              <button className="glow-btn glow-btn-danger" onClick={() => { setShowDisableForm(true); setError(''); }}>
                Disable App Lock
              </button>
            ) : (
              <form onSubmit={handleDisableLock} className="glass-panel" style={{ padding: '16px', marginTop: '10px', width: '100%', maxWidth: '400px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div className="input-group" style={{ margin: 0 }}>
                  <span className="input-label">Enter Passcode to Confirm</span>
                  <input
                    type="password"
                    required
                    className="input-field"
                    value={verifyPasscode}
                    onChange={(e) => setVerifyPasscode(e.target.value)}
                    placeholder="••••"
                  />
                </div>
                {error && <p style={{ color: '#ff3b30', fontSize: '12px' }}>{error}</p>}
                <div className="flex-row" style={{ gap: '12px', flexWrap: 'wrap' }}>
                  <button type="submit" className="glow-btn glow-btn-danger" disabled={savingLock}>
                    Confirm Disable
                  </button>
                  <button type="button" className="glow-btn" onClick={() => setShowDisableForm(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        ) : (
          <div className="flex-col" style={{ gap: '12px', alignItems: 'flex-start' }}>
            <p style={{ fontSize: '14px', color: 'var(--text-dark)' }}>App Lock is currently disabled.</p>
            
            {!showPasscodeForm ? (
              <button className="glow-btn glow-btn-primary" onClick={() => { setShowPasscodeForm(true); setError(''); }}>
                Enable App Lock
              </button>
            ) : (
              <form onSubmit={handleEnableLock} className="glass-panel" style={{ padding: '20px', marginTop: '10px', width: '100%', maxWidth: '400px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="input-group" style={{ margin: 0 }}>
                  <span className="input-label">Choose Passcode</span>
                  <input
                    type="password"
                    required
                    className="input-field"
                    value={passcode}
                    onChange={(e) => setPasscode(e.target.value)}
                    placeholder="e.g. 1234"
                  />
                </div>

                <div className="input-group" style={{ margin: 0 }}>
                  <span className="input-label">Confirm Passcode</span>
                  <input
                    type="password"
                    required
                    className="input-field"
                    value={confirmPasscode}
                    onChange={(e) => setConfirmPasscode(e.target.value)}
                    placeholder="e.g. 1234"
                  />
                </div>

                {error && <p style={{ color: '#ff3b30', fontSize: '12px' }}>{error}</p>}
                
                <div className="flex-row" style={{ gap: '12px', flexWrap: 'wrap' }}>
                  <button type="submit" className="glow-btn glow-btn-primary" disabled={savingLock}>
                    Save Passcode
                  </button>
                  <button type="button" className="glow-btn" onClick={() => setShowPasscodeForm(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>

      {/* Panic Reset */}
      <div className="glass-card" style={{ padding: '24px', borderColor: 'rgba(255, 59, 48, 0.2)', background: 'rgba(255, 59, 48, 0.02)' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#ff3b30', marginBottom: '8px' }}>Panic Reset Area</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '20px' }}>
          Wipe all CodexSwitcher configuration settings, active profiles metadata, backups, and security passwords. Your current active profile state inside Codex will be preserved as is, but this CodexSwitcher application will be completely reset.
        </p>

        <button className="glow-btn glow-btn-danger" onClick={() => { setShowPanicModal(true); setPanicInput(''); }}>
          🚨 Execute Panic Reset
        </button>
      </div>

      {/* Panic Modal */}
      {showPanicModal && (
        <div className="modal-overlay">
          <div className="glass-panel modal-content" style={{ boxShadow: '0 0 40px rgba(255, 59, 48, 0.3)', borderColor: '#ff3b30' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#ff3b30', marginBottom: '12px' }}>CRITICAL WARNING</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '20px', lineHeight: '1.5' }}>
              This operation will permanently delete all metadata profiles, historical configuration backups, and local audit logs. This cannot be undone. 
              To confirm, type <strong style={{ color: '#ff3b30' }}>PANIC</strong> below:
            </p>

            <div className="input-group" style={{ marginBottom: '20px' }}>
              <input
                type="text"
                className="input-field"
                placeholder="Type PANIC to verify"
                value={panicInput}
                onChange={(e) => setPanicInput(e.target.value)}
                autoFocus
              />
            </div>

            <div className="flex-row" style={{ gap: '12px', justifyContent: 'flex-end' }}>
              <button className="glow-btn" onClick={() => setShowPanicModal(false)} disabled={panicExecuting}>
                Cancel
              </button>
              <button
                className="glow-btn glow-btn-danger"
                disabled={panicExecuting || panicInput !== 'PANIC'}
                onClick={triggerPanicReset}
              >
                {panicExecuting ? 'Executing Wipe...' : 'Confirm Full Wipe'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
