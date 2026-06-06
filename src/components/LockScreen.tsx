import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface LockScreenProps {
  onUnlock: () => void;
}

export const LockScreen: React.FC<LockScreenProps> = ({ onUnlock }) => {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcode) return;

    setIsLoading(true);
    setError('');

    try {
      const isValid = await invoke<boolean>('verify_app_lock', { password: passcode });
      if (isValid) {
        onUnlock();
      } else {
        setError('Incorrect passcode. Please try again.');
        setPasscode('');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: '#030303',
        backgroundImage: 'radial-gradient(circle at center, rgba(0, 240, 255, 0.1) 0%, transparent 70%)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        className="glass-panel"
        style={{
          width: '320px',
          padding: '40px 30px',
          textAlign: 'center',
          boxShadow: '0 0 40px rgba(0, 240, 255, 0.1)',
        }}
      >
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            border: '2px solid var(--neon-blue)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
            boxShadow: '0 0 15px var(--neon-blue-glow)',
          }}
        >
          <span style={{ fontSize: '28px' }}>🔒</span>
        </div>
        
        <h2 style={{ fontSize: '22px', fontWeight: 600, marginBottom: '8px' }}>Security Lock</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '24px' }}>
          Enter passcode to access CodexSwitcher
        </p>

        <form onSubmit={handleSubmit} className="flex-col" style={{ gap: '16px' }}>
          <div className="input-group" style={{ margin: 0 }}>
            <input
              type="password"
              className="input-field"
              placeholder="••••"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              disabled={isLoading}
              autoFocus
              style={{
                textAlign: 'center',
                fontSize: '24px',
                letterSpacing: '8px',
                padding: '10px',
              }}
            />
          </div>

          {error && (
            <p style={{ color: '#ff3b30', fontSize: '12px', marginTop: '-4px' }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            className="glow-btn glow-btn-primary"
            disabled={isLoading || !passcode}
            style={{ width: '100%' }}
          >
            {isLoading ? 'Decrypting...' : 'Access Command Center'}
          </button>
        </form>
      </div>
    </div>
  );
};
