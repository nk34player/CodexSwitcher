import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Sidebar } from './components/Sidebar';
import { DashboardView } from './components/DashboardView';
import { ProfilesView } from './components/ProfilesView';
import { BackupsView } from './components/BackupsView';
import { ActivityLogView } from './components/ActivityLogView';
import { SettingsView } from './components/SettingsView';
import { LockScreen } from './components/LockScreen';

export interface Profile {
  id: string;
  name: string;
  email?: string;
  display_name?: string;
  plan?: string;
  avatar_color: string;
  avatar_emoji: string;
  is_default: boolean;
  shares_config_with?: string | null;
}

interface ConfigState {
  active_profile_id: string | null;
  codex_app_path: string | null;
  profiles: Profile[];
  app_lock_enabled: boolean;
}

function App() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [codexAppPath, setCodexAppPath] = useState<string | null>(null);
  const [appLockEnabled, setAppLockEnabled] = useState(false);
  const [locked, setLocked] = useState(false);
  const [codexRunning, setCodexRunning] = useState(false);
  const [activeView, setActiveView] = useState('dashboard');
  const [initializing, setInitializing] = useState(true);
  const [bootStatus, setBootStatus] = useState('Reading saved profiles...');

  useEffect(() => {
    let cancelled = false;

    const launchInitialization = () => {
      window.setTimeout(() => {
        if (!cancelled) {
          initializeState();
        }
      }, 80);
    };

    const frameId = window.requestAnimationFrame(launchInitialization);
    
    // Polling interval to check if Codex is running
    const interval = setInterval(async () => {
      try {
        const running = await invoke<boolean>('check_codex_status');
        setCodexRunning(running);
      } catch (err) {
        console.error(err);
      }
    }, 2500);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  const initializeState = async () => {
    try {
      setBootStatus('Reading saved profiles...');
      const state = await invoke<ConfigState>('get_profiles');

      const hydratedState =
        state.profiles.length > 0
          ? await (async () => {
              setBootStatus('Syncing local analytics...');
              return invoke<ConfigState>('hydrate_boot_state');
            })()
          : state;

      setBootStatus('Polishing dashboard...');
      const finalState = hydratedState;
      setProfiles(finalState.profiles);
      setActiveProfileId(finalState.active_profile_id);
      setCodexAppPath(finalState.codex_app_path);
      setAppLockEnabled(finalState.app_lock_enabled);
      
      // Auto-select active profile if present, else fallback to default, else null
      if (finalState.active_profile_id) {
        setSelectedProfileId(finalState.active_profile_id);
      } else {
        const defaultProfile = finalState.profiles.find(p => p.is_default);
        setSelectedProfileId(defaultProfile ? defaultProfile.id : (finalState.profiles[0]?.id || null));
      }

      // If app lock is enabled, lock the screen initially
      if (finalState.app_lock_enabled) {
        setLocked(true);
      }

      // Check initial running status
      const running = await invoke<boolean>('check_codex_status');
      setCodexRunning(running);
    } catch (err) {
      console.error('Initialization failed:', err);
    } finally {
      setInitializing(false);
    }
  };

  const syncState = async () => {
    try {
      const state = await invoke<ConfigState>('get_profiles');
      setProfiles(state.profiles);
      setActiveProfileId(state.active_profile_id);
      setCodexAppPath(state.codex_app_path);
      setAppLockEnabled(state.app_lock_enabled);
    } catch (err) {
      console.error('Failed to sync state:', err);
    }
  };

  const handleUnlock = () => {
    setLocked(false);
  };

  const handleSwitchProfile = async (profileId: string) => {
    await invoke('switch_profile', { targetId: profileId });
    await syncState();
    setActiveProfileId(profileId);
    setSelectedProfileId(profileId);
    setCodexRunning(true);
  };

  const handleLaunchCodex = async () => {
    await invoke('launch_codex', { customPath: codexAppPath });
    setCodexRunning(true);
  };

  const handleCloseCodex = async () => {
    await invoke('close_codex');
    setCodexRunning(false);
  };

  const handleSaveProfile = async (profile: Profile, cloneActiveSettings: boolean) => {
    await invoke('save_profile', { profile, cloneActiveSettings });
    await syncState();
    if (profiles.length === 0 || !selectedProfileId) {
      setSelectedProfileId(profile.id);
    }
  };

  const handleDeleteProfile = async (profileId: string) => {
    await invoke('delete_profile', { id: profileId });
    await syncState();
    if (selectedProfileId === profileId) {
      setSelectedProfileId(activeProfileId || profiles[0]?.id || null);
    }
  };

  const handleUpdatePath = async (path: string | null) => {
    await invoke('set_codex_app_path', { path });
    await syncState();
  };

  const handleUpdateAppLock = async (enabled: boolean, passcode?: string) => {
    if (enabled && passcode) {
      await invoke('set_app_lock', { password: passcode });
    } else {
      await invoke('set_app_lock', { password: null });
    }
    await syncState();
  };

  const handlePanicReset = async () => {
    await invoke('panic_reset');
  };

  const handleRestoreBackup = async (backupId: string) => {
    await invoke('restore_backup', { backupId });
    await syncState();
    setCodexRunning(true);
  };

  if (initializing) {
    return (
      <div className="boot-screen">
        <div style={{ color: 'var(--neon-blue)', fontSize: '24px' }} className="spin-icon">⚙️</div>
        <p className="boot-status">{bootStatus}</p>
      </div>
    );
  }

  if (locked) {
    return <LockScreen onUnlock={handleUnlock} />;
  }

  const selectedProfile = profiles.find(p => p.id === selectedProfileId) || null;

  return (
    <div className="app-container">
      {/* Sidebar navigation */}
      <Sidebar
        profiles={profiles}
        activeProfileId={activeProfileId}
        selectedProfileId={selectedProfileId}
        activeView={activeView}
        setActiveView={setActiveView}
        setSelectedProfileId={setSelectedProfileId}
        codexRunning={codexRunning}
      />

      {/* Main Content Pane */}
      <div style={{ flex: 1, minHeight: '100%', overflow: 'hidden' }}>
        {activeView === 'dashboard' && (
          <DashboardView
            selectedProfile={selectedProfile}
            activeProfileId={activeProfileId}
            codexRunning={codexRunning}
            onSwitchProfile={handleSwitchProfile}
            onLaunchCodex={handleLaunchCodex}
            onCloseCodex={handleCloseCodex}
            onRefreshProfiles={syncState}
          />
        )}

        {activeView === 'profiles' && (
          <ProfilesView
            profiles={profiles}
            activeProfileId={activeProfileId}
            onSaveProfile={handleSaveProfile}
            onDeleteProfile={handleDeleteProfile}
            onSwitchProfile={handleSwitchProfile}
          />
        )}

        {activeView === 'backups' && (
          <BackupsView
            profiles={profiles}
            activeProfileId={activeProfileId}
            codexRunning={codexRunning}
            onRestoreBackup={handleRestoreBackup}
          />
        )}

        {activeView === 'activity' && <ActivityLogView />}

        {activeView === 'settings' && (
          <SettingsView
            codexAppPath={codexAppPath}
            appLockEnabled={appLockEnabled}
            onUpdatePath={handleUpdatePath}
            onUpdateAppLock={handleUpdateAppLock}
            onPanicReset={handlePanicReset}
          />
        )}
      </div>
    </div>
  );
}

export default App;
