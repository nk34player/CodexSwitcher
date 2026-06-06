import React, { useState, useEffect } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { Profile } from '../App';

interface SidebarProps {
  profiles: Profile[];
  activeProfileId: string | null;
  selectedProfileId: string | null;
  activeView: string;
  setActiveView: (view: string) => void;
  setSelectedProfileId: (id: string | null) => void;
  codexRunning: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  profiles,
  activeProfileId,
  selectedProfileId,
  activeView,
  setActiveView,
  setSelectedProfileId,
  codexRunning
}) => {
  const activeProfile = profiles.find(p => p.id === activeProfileId);
  const [appVersion, setAppVersion] = useState<string>('');
  const [systemOs, setSystemOs] = useState<string>('');

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion(''));
  }, []);

  useEffect(() => {
    invoke<string>('get_system_os_label')
      .then(setSystemOs)
      .catch(() => setSystemOs('Unknown'));
  }, []);

  const navigationItems = [
    { id: 'dashboard', label: 'Dashboard', icon: '⚡' },
    { id: 'profiles', label: 'Manage Profiles', icon: '👤' },
    { id: 'backups', label: 'System Backups', icon: '💾' },
    { id: 'activity', label: 'Activity Logs', icon: '📋' },
    { id: 'settings', label: 'App Settings', icon: '⚙️' },
  ];

  return (
    <div className="glass-panel sidebar">
      {/* Header */}
      <div>
        <h1 style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '1px' }}>
          CODEX <span className="neon-text">SWITCHER</span>
        </h1>
        {appVersion && (
          <p style={{ fontSize: '10px', color: 'var(--text-dark)', fontWeight: 600, letterSpacing: '2px', marginTop: '2px' }}>
            VERSION: {appVersion}
          </p>
        )}
      </div>

      {/* Navigation Menu */}
      <div className="flex-col" style={{ gap: '8px' }}>
        {navigationItems.map((item) => (
          <button
            key={item.id}
            onClick={() => {
              setActiveView(item.id);
              if (item.id === 'dashboard') {
                setSelectedProfileId(activeProfileId);
              }
            }}
            className="flex-row"
            style={{
              background: activeView === item.id ? 'rgba(0, 240, 255, 0.1)' : 'transparent',
              border: '1px solid',
              borderColor: activeView === item.id ? 'rgba(0, 240, 255, 0.2)' : 'transparent',
              color: activeView === item.id ? 'var(--neon-blue)' : 'var(--text-secondary)',
              padding: '10px 14px',
              borderRadius: '8px',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
              fontSize: '14px',
              fontWeight: 600,
              gap: '12px',
              textAlign: 'left',
              transition: 'all 0.2s ease',
              width: '100%',
            }}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      {/* Profiles Divider */}
      <div style={{ height: '1px', background: 'var(--border-color)' }}></div>

      {/* Profiles List */}
      <div className="flex-col flex-1" style={{ gap: '12px', overflowY: 'auto' }}>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, letterSpacing: '0.5px' }}>
          PROFILES
        </div>

        {profiles.length === 0 ? (
          <div style={{ fontSize: '12px', color: 'var(--text-dark)', textAlign: 'center', padding: '16px 0' }}>
            No profiles added.
          </div>
        ) : (
          profiles.map((profile) => {
            const isActive = profile.id === activeProfileId;
            const isSelected = profile.id === selectedProfileId;
            const profileTitle = profile.display_name || profile.name;
            const profileSubtitle = profile.email || 'No account email linked';
            return (
              <div
                key={profile.id}
                onClick={() => {
                  setSelectedProfileId(profile.id);
                  setActiveView('dashboard');
                }}
                className="glass-card"
                style={{
                  padding: '10px 12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  borderColor: isSelected ? 'var(--neon-blue)' : 'var(--border-color)',
                  boxShadow: isSelected ? '0 0 10px rgba(0, 240, 255, 0.15)' : 'none',
                  background: isSelected ? 'rgba(25, 25, 35, 0.8)' : undefined,
                }}
              >
                {/* Avatar Icon */}
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '8px',
                    background: profile.avatar_color || '#1e293b',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '18px',
                    flexShrink: 0,
                  }}
                >
                  {profile.avatar_emoji || '⚙️'}
                </div>

                {/* Profile Information */}
                <div className="flex-col" style={{ gap: '2px', overflow: 'hidden', flex: 1 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {profileTitle}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-dark)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {profileSubtitle}
                  </div>
                </div>

                {/* Status indicator */}
                {isActive && (
                  <div
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: '#34c759',
                      boxShadow: '0 0 8px rgba(52, 199, 89, 0.6)',
                      flexShrink: 0,
                    }}
                    title="Active profile"
                  />
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Active Profile Status at Bottom */}
      <div
        className="glass-card"
        style={{
          padding: '12px',
          background: 'rgba(0, 0, 0, 0.3)',
          borderColor: 'rgba(255, 255, 255, 0.04)',
        }}
      >
        <div style={{ fontSize: '10px', color: 'var(--text-dark)', fontWeight: 600, marginBottom: '6px' }}>
          SYSTEM STATE
        </div>
        <div className="flex-row" style={{ gap: '8px' }}>
          <div
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: codexRunning ? '#34c759' : '#ff3b30',
              boxShadow: codexRunning ? '0 0 8px rgba(52, 199, 89, 0.5)' : '0 0 8px rgba(255, 59, 48, 0.5)',
            }}
          />
          <div style={{ fontSize: '12px', fontWeight: 500 }}>
            Codex App: {codexRunning ? 'Running' : 'Closed'}
          </div>
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '6px' }}>
          System OS: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{systemOs || 'Detecting...'}</span>
        </div>
        {activeProfile && (
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Active Account: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{activeProfile.display_name || activeProfile.name}</span>
          </div>
        )}
      </div>
    </div>
  );
};
