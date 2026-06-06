import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Profile } from '../App';

interface DashboardViewProps {
  selectedProfile: Profile | null;
  activeProfileId: string | null;
  codexRunning: boolean;
  onSwitchProfile: (profileId: string) => Promise<void>;
  onLaunchCodex: () => Promise<void>;
  onCloseCodex: () => Promise<void>;
  onRefreshProfiles?: () => Promise<void>;
}

interface Analytics {
  plan: string;
  email: string;
  name: string;
  daily_requests: number;
  weekly_requests: number;
  total_threads: number;
  total_agent_jobs: number;
  live_primary_used_percent?: number | null;
  live_primary_reset_at?: number | null;
  live_secondary_used_percent?: number | null;
  live_secondary_reset_at?: number | null;
}

const dashboardAnalyticsCache = new Map<string, Analytics>();

const formatResetTime = (timestamp: number | undefined | null): string => {
  if (!timestamp) return '';
  const date = new Date(timestamp * 1000);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const formatResetDate = (timestamp: number | undefined | null): string => {
  if (!timestamp) return '';
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

export const DashboardView: React.FC<DashboardViewProps> = ({
  selectedProfile,
  activeProfileId,
  codexRunning,
  onSwitchProfile,
  onLaunchCodex,
  onCloseCodex,
  onRefreshProfiles
}) => {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [switchStep, setSwitchStep] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [loadedProfileId, setLoadedProfileId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedProfile) {
      let interval: number | undefined;
      let cancelled = false;
      const cachedAnalytics = dashboardAnalyticsCache.get(selectedProfile.id) || null;
      const profileChanged = loadedProfileId !== selectedProfile.id && !cachedAnalytics;

      if (cachedAnalytics) {
        setAnalytics(cachedAnalytics);
        setLoadedProfileId(selectedProfile.id);
        setLoadingAnalytics(false);
      } else if (profileChanged) {
        setAnalytics(null);
        setLoadingAnalytics(true);
      }

      const initializeAnalytics = async () => {
        const refreshing = await invoke<boolean>('is_profile_refreshing', { profileId: selectedProfile.id }).catch(() => false);
        if (cancelled) {
          return;
        }

        if (refreshing) {
          setLoadingAnalytics(true);
          return;
        }

        const shouldWaitForFullRefresh = profileChanged && !!(selectedProfile.email || selectedProfile.display_name);
        await fetchAnalytics(selectedProfile.id, shouldWaitForFullRefresh, profileChanged);
        if (!cancelled) {
          setLoadedProfileId(selectedProfile.id);
          interval = window.setInterval(() => {
            fetchAnalytics(selectedProfile.id, false, false);
          }, 30000);
        }
      };

      initializeAnalytics();

      return () => {
        cancelled = true;
        if (interval) {
          clearInterval(interval);
        }
      };
    } else {
      setAnalytics(null);
      setLoadingAnalytics(false);
      setLoadedProfileId(null);
    }
  }, [selectedProfile?.id, activeProfileId, loadedProfileId]);

  useEffect(() => {
    let unlistenAnalyticsFn: (() => void) | undefined;
    let unlistenRefreshFn: (() => void) | undefined;
    
    const setupListener = async () => {
      const analyticsUnsub = await listen<any>('profile-analytics-updated', (event) => {
        const { profile_id, analytics } = event.payload;
        if (selectedProfile && profile_id === selectedProfile.id) {
          const prevEmail = selectedProfile.email || '';
          const nextEmail = analytics.email || '';
          const prevPlan = selectedProfile.plan || '';
          const nextPlan = analytics.plan || '';
          const prevName = selectedProfile.display_name || '';
          
          const emailChanged = nextEmail !== prevEmail;
          const planChanged = (nextEmail || prevEmail) && (nextPlan !== prevPlan);
          const nameChanged = nextEmail && nextEmail !== prevName;
          
          setAnalytics(analytics);
          dashboardAnalyticsCache.set(profile_id, analytics);
          setLoadedProfileId(profile_id);
          
          if (onRefreshProfiles && (emailChanged || planChanged || nameChanged)) {
            onRefreshProfiles();
          }
        }
      });
      unlistenAnalyticsFn = analyticsUnsub;

      const refreshUnsub = await listen<any>('profile-refresh-state', (event) => {
        const { profile_id, refreshing } = event.payload;
        if (selectedProfile && profile_id === selectedProfile.id) {
          setLoadingAnalytics(!!refreshing);
        }
      });
      unlistenRefreshFn = refreshUnsub;
    };
    
    setupListener();
    return () => {
      if (unlistenAnalyticsFn) unlistenAnalyticsFn();
      if (unlistenRefreshFn) unlistenRefreshFn();
    };
  }, [selectedProfile?.id, onRefreshProfiles]);

  const syncProfileMetadata = async (data: Analytics) => {
    const prevEmail = selectedProfile?.email || '';
    const nextEmail = data.email || '';
    const prevPlan = selectedProfile?.plan || '';
    const nextPlan = data.plan || '';
    const prevName = selectedProfile?.display_name || '';

    const emailChanged = nextEmail !== prevEmail;
    const planChanged = (nextEmail || prevEmail) && (nextPlan !== prevPlan);
    const nameChanged = nextEmail && nextEmail !== prevName;

    if (onRefreshProfiles && (emailChanged || planChanged || nameChanged)) {
      await onRefreshProfiles();
    }
  };

  const refreshAnalytics = async (profileId: string) => {
    const data = await invoke<Analytics>('refresh_profile', { profileId });
    setAnalytics(data);
    dashboardAnalyticsCache.set(profileId, data);
    setLoadedProfileId(profileId);
    await syncProfileMetadata(data);
  };

  const fetchAnalytics = async (profileId: string, forceRefresh = false, showLoader = true) => {
    if (showLoader) {
      setLoadingAnalytics(true);
    }
    try {
      if (forceRefresh) {
        await refreshAnalytics(profileId);
      } else {
        const data = await invoke<Analytics>('get_profile_analytics', { 
          profileId, 
          forceRefresh: false 
        });
        setAnalytics(data);
        dashboardAnalyticsCache.set(profileId, data);
        setLoadedProfileId(profileId);
        await syncProfileMetadata(data);
      }
    } catch (err) {
      console.error('Failed to fetch analytics:', err);
      // Setup empty default values
      setAnalytics({
        plan: selectedProfile?.plan || '',
        email: selectedProfile?.email || '',
        name: selectedProfile?.display_name || '',
        daily_requests: 0,
        weekly_requests: 0,
        total_threads: 0,
        total_agent_jobs: 0,
        live_primary_used_percent: null,
        live_primary_reset_at: null,
        live_secondary_used_percent: null,
        live_secondary_reset_at: null,
      });
    } finally {
      if (showLoader) {
        setLoadingAnalytics(false);
      }
    }
  };

  const handleManualRefresh = (profileId: string) => {
    setLoadingAnalytics(true);

    window.setTimeout(() => {
      refreshAnalytics(profileId)
        .catch((err) => {
          console.error('Failed to refresh analytics:', err);
        })
        .finally(() => {
          setLoadingAnalytics(false);
        });
    }, 0);
  };

  if (!selectedProfile) {
    return (
      <div className="flex-col" style={{ flex: 1, padding: '40px', justifyContent: 'center', alignItems: 'center' }}>
        <span style={{ fontSize: '48px', marginBottom: '20px' }}>🖥️</span>
        <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-secondary)' }}>
          Select a profile from the sidebar or create a new one to begin.
        </h2>
      </div>
    );
  }

  const isActive = selectedProfile.id === activeProfileId;
  
  const handleSwitchClick = () => {
    if (codexRunning) {
      setShowConfirm(true);
    } else {
      triggerSwitch();
    }
  };

  const triggerSwitch = async () => {
    setShowConfirm(false);
    setSwitching(true);
    try {
      setSwitchStep('Closing Codex app processes...');
      await new Promise(r => setTimeout(r, 600));
      
      setSwitchStep('Creating secure backup of current configuration...');
      await new Promise(r => setTimeout(r, 600));
      
      setSwitchStep('Wiping active directories safely...');
      await new Promise(r => setTimeout(r, 500));
      
      setSwitchStep('Injecting profile: ' + selectedProfile.name + '...');
      await new Promise(r => setTimeout(r, 600));
      
      setSwitchStep('Re-launching Codex desktop application...');
      await onSwitchProfile(selectedProfile.id);
      
      setSwitchStep('Complete!');
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      alert('Error switching profile: ' + err);
    } finally {
      setSwitching(false);
      setSwitchStep('');
    }
  };

  const getPlanBadgeStyles = (plan: string) => {
    const p = plan.toLowerCase();
    if (p === 'plus' || p === 'pro') {
      return {
        background: 'rgba(138, 43, 226, 0.15)',
        color: '#c084fc',
        border: '1px solid rgba(138, 43, 226, 0.4)',
        boxShadow: '0 0 10px rgba(138, 43, 226, 0.15)',
      };
    }
    if (p === 'team' || p === 'enterprise') {
      return {
        background: 'rgba(52, 199, 89, 0.15)',
        color: '#34c759',
        border: '1px solid rgba(52, 199, 89, 0.4)',
        boxShadow: '0 0 10px rgba(52, 199, 89, 0.15)',
      };
    }
    return {
      background: 'rgba(255, 255, 255, 0.06)',
      color: 'var(--text-secondary)',
      border: '1px solid var(--border-color)',
    };
  };

  const planType = analytics?.plan || selectedProfile.plan || 'free';
  const hasLogin = analytics?.email || selectedProfile.email;
  const accountName = analytics?.name || selectedProfile.display_name || selectedProfile.name;
  const accountEmail = analytics?.email || selectedProfile.email;
  const canRefreshAnalytics = isActive && !!accountEmail;

  const dailyRequests = analytics?.daily_requests || 0;

  return (
    <div className="view-container">
      
      {/* Profile Header Card */}
      <div
        className="glass-card"
        style={{
          padding: '20px',
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '20px',
          background: 'radial-gradient(circle at 10% 20%, rgba(0, 240, 255, 0.03) 0%, rgba(25, 25, 35, 0.4) 100%)',
          position: 'relative',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        {/* Avatar */}
        <div
          style={{
            width: '72px',
            height: '72px',
            borderRadius: '16px',
            background: selectedProfile.avatar_color || '#1e293b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '36px',
            boxShadow: '0 4px 15px rgba(0, 0, 0, 0.2)',
            flexShrink: 0,
          }}
        >
          {selectedProfile.avatar_emoji || '👤'}
        </div>

        {/* Title details */}
        <div className="flex-col" style={{ gap: '6px', flex: '1 1 200px' }}>
          <div className="flex-row" style={{ gap: '12px', flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: '24px', fontWeight: 700 }}>{accountName}</h1>
            
            {isActive ? (
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '3px 8px',
                  borderRadius: '12px',
                  background: 'rgba(0, 240, 255, 0.15)',
                  color: 'var(--neon-blue)',
                  border: '1px solid rgba(0, 240, 255, 0.3)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  boxShadow: '0 0 8px rgba(0, 240, 255, 0.2)',
                }}
              >
                Active
              </span>
            ) : (
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '3px 8px',
                  borderRadius: '12px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  color: 'var(--text-dark)',
                  border: '1px solid var(--border-color)',
                  textTransform: 'uppercase',
                }}
              >
                Inactive
              </span>
            )}

            {hasLogin && (
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '3px 8px',
                  borderRadius: '12px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  ...getPlanBadgeStyles(planType),
                }}
              >
                {planType} Account
              </span>
            )}
          </div>

          <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
            {accountEmail || 'No account email linked'}
          </p>
        </div>
      </div>

      {/* Switching Panel */}
      <div style={{ marginTop: '24px', flexShrink: 0 }}>
        {isActive ? (
          <div
            className="glass-card"
            style={{
              padding: '20px',
              display: 'flex',
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: '16px',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'rgba(52, 199, 89, 0.03)',
              borderColor: 'rgba(52, 199, 89, 0.1)',
            }}
          >
            <div className="flex-col" style={{ gap: '4px', flex: '1 1 200px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 600 }}>Active Profile</h3>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                {codexRunning 
                  ? 'OpenAI Codex is currently running with this profile.' 
                  : 'This profile is configured. Launch Codex to start developing.'}
              </p>
            </div>

            <div className="flex-row" style={{ gap: '12px', flexWrap: 'wrap' }}>
              {codexRunning ? (
                <button className="glow-btn glow-btn-danger" onClick={onCloseCodex}>
                  🔴 Force Stop Codex
                </button>
              ) : (
                <button className="glow-btn glow-btn-primary" onClick={onLaunchCodex}>
                  🚀 Launch Codex App
                </button>
              )}
            </div>
          </div>
        ) : (
          <div
            className="glass-card"
            style={{
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              background: 'radial-gradient(ellipse at top right, rgba(0, 240, 255, 0.05) 0%, transparent 80%)',
              borderColor: 'rgba(0, 240, 255, 0.1)',
            }}
          >
            <div className="flex-col" style={{ gap: '4px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Ready to Switch?</h3>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                Activate <strong style={{ color: 'var(--text-primary)' }}>{selectedProfile.name}</strong>. 
                This will automatically close Codex if it is currently running, create a configuration backup, 
                and launch Codex with this profile's environment.
              </p>
            </div>

            <div>
              <button
                className="glow-btn glow-btn-primary"
                onClick={handleSwitchClick}
                style={{ padding: '12px 32px', fontSize: '15px', width: '100%', maxWidth: '280px' }}
              >
                🔒 Switch and Load Profile
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Analytics dashboard */}
      <div className="flex-row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: '32px', marginBottom: '16px', flexShrink: 0, flexWrap: 'wrap', gap: '8px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>
          Profile Activity & Analytics
        </h2>
        {canRefreshAnalytics && (
          <button 
            className="glow-btn" 
            style={{ padding: '6px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
            onClick={() => handleManualRefresh(selectedProfile.id)}
          >
            🔄 Refresh
          </button>
        )}
      </div>

      {loadingAnalytics ? (
        <div className="glass-card flex-col" style={{ padding: '40px', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <div className="profile-loader-shell" style={{ minHeight: '120px' }}>
            <div className="profile-refresh-spinner" aria-label="Refreshing dashboard analytics" />
            <p className="profile-refresh-text" style={{ fontSize: '13px' }}>
              Scanning profile databases for analytics...
            </p>
          </div>
        </div>
      ) : (
        <div className="dashboard-grid" style={{ flexShrink: 0 }}>
          
          {/* Card 1: Daily Usage Snapshot */}
          <div className="glass-card flex-col" style={{ padding: '20px', gap: '8px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-dark)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Daily Usage Snapshot
            </div>
            {!hasLogin ? (
              <div className="flex-col" style={{ gap: '4px', flex: 1, justifyContent: 'center' }}>
                <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                  Offline Profile
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-dark)' }}>
                  Sign in through Codex app to link account rate limits.
                </div>
              </div>
            ) : analytics?.live_primary_used_percent !== undefined && analytics?.live_primary_used_percent !== null ? (
              <>
                <div className="flex-row" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '4px' }}>
                  <div className="neon-text" style={{ fontSize: '30px', fontWeight: 800 }}>
                    {100 - analytics.live_primary_used_percent}% <span style={{ fontSize: '14px', color: 'var(--text-secondary)', fontWeight: 500 }}>usage remaining</span>
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--neon-blue)', fontWeight: 700 }}>
                    Live Limit
                  </div>
                </div>
                {/* Progress Bar */}
                <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px', overflow: 'hidden', marginTop: '4px' }}>
                  <div 
                    style={{ 
                      height: '100%', 
                      width: `${100 - analytics.live_primary_used_percent}%`, 
                      background: (100 - analytics.live_primary_used_percent) > 50 ? '#00f0ff' : (100 - analytics.live_primary_used_percent) > 20 ? '#ff9f0a' : '#ff3b30',
                      boxShadow: (100 - analytics.live_primary_used_percent) > 50 ? '0 0 8px rgba(0, 240, 255, 0.4)' : 'none',
                      transition: 'width 0.3s ease'
                    }} 
                  />
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  Resets every 5 hours • Next reset is at {formatResetTime(analytics.live_primary_reset_at)}
                </div>
                <div className="metric-context">
                  Live remaining capacity is read from local Codex account metadata already cached on this machine, with no remote sync from CodexSwitcher.
                </div>
              </>
            ) : (
              <>
                <div className="flex-row" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '4px' }}>
                  <div className="neon-text" style={{ fontSize: '30px', fontWeight: 800 }}>
                    {dailyRequests} <span style={{ fontSize: '14px', color: 'var(--text-secondary)', fontWeight: 500 }}>queries logged</span>
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--neon-blue)', fontWeight: 700 }}>
                    Local Count
                  </div>
                </div>
                <div className="metric-context">
                  Read from local Codex history files only, so usage estimates stay on-device and never require uploading your profile data.
                </div>
              </>
            )}
          </div>

          {/* Card 2: Weekly Requests */}
          <div className="glass-card flex-col" style={{ padding: '20px', gap: '8px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-dark)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Weekly Activity (7d)
            </div>
            {!hasLogin ? (
              <div className="flex-col" style={{ gap: '4px', flex: 1, justifyContent: 'center' }}>
                <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                  No Logs Loaded
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-dark)' }}>
                  Run queries in Codex to populate weekly analytics.
                </div>
              </div>
            ) : analytics?.live_secondary_used_percent !== undefined && analytics?.live_secondary_used_percent !== null ? (
              <>
                <div className="flex-row" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '4px' }}>
                  <div className="neon-text" style={{ fontSize: '30px', fontWeight: 800 }}>
                    {100 - analytics.live_secondary_used_percent}% <span style={{ fontSize: '14px', color: 'var(--text-secondary)', fontWeight: 500 }}>remaining</span>
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--neon-blue)', fontWeight: 700 }}>
                    Weekly
                  </div>
                </div>
                {/* Progress Bar */}
                <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px', overflow: 'hidden', marginTop: '4px' }}>
                  <div 
                    style={{ 
                      height: '100%', 
                      width: `${100 - analytics.live_secondary_used_percent}%`, 
                      background: (100 - analytics.live_secondary_used_percent) > 50 ? '#00f0ff' : (100 - analytics.live_secondary_used_percent) > 20 ? '#ff9f0a' : '#ff3b30',
                      boxShadow: (100 - analytics.live_secondary_used_percent) > 50 ? '0 0 8px rgba(0, 240, 255, 0.4)' : 'none',
                      transition: 'width 0.3s ease'
                    }} 
                  />
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  Resets on {formatResetDate(analytics.live_secondary_reset_at)}
                </div>
                <div className="metric-context">
                  Live weekly usage is reconciled from local metadata and offline account claims already stored by the Codex desktop app.
                </div>
              </>
            ) : (
              <>
                <div className="neon-text" style={{ fontSize: '36px', fontWeight: 800, margin: '10px 0' }}>
                  {analytics?.weekly_requests || 0}
                </div>
                <div className="metric-context">
                  Aggregated from the last 7 days of local historical logs to show recent pace without contacting any external service.
                </div>
              </>
            )}
          </div>

          {/* Card 3: Conversation Threads */}
          <div className="glass-card" style={{ padding: '20px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-dark)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Conversation Threads
            </div>
            <div className="neon-text" style={{ fontSize: '36px', fontWeight: 800, margin: '10px 0' }}>
              {analytics?.total_threads || 0}
            </div>
            <div className="metric-context">
              Counts conversation threads discovered in your local Codex state database so the dashboard can summarize history privately.
            </div>
          </div>

          {/* Card 4: Coding Agent Jobs */}
          <div className="glass-card" style={{ padding: '20px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-dark)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Autonomous Agent Jobs
            </div>
            <div className="neon-text" style={{ fontSize: '36px', fontWeight: 800, margin: '10px 0' }}>
              {analytics?.total_agent_jobs || 0}
            </div>
            <div className="metric-context">
              Derived from local agent and rollout records to show how much autonomous coding work this profile has actually executed.
            </div>
          </div>

        </div>
      )}

      {!hasLogin && !loadingAnalytics && (
        <div
          className="glass-card flex-row"
          style={{
            marginTop: '24px',
            padding: '16px',
            background: 'rgba(255, 159, 10, 0.03)',
            borderColor: 'rgba(255, 159, 10, 0.1)',
            gap: '12px',
          }}
        >
          <span style={{ fontSize: '20px' }}>⚠️</span>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', flex: 1 }}>
            <strong>No active login session detected</strong> for this profile. 
            Once you switch to this profile and launch Codex, please sign in through the Codex desktop application's native login flow. 
            CodexSwitcher will automatically detect and link your account email, display name, and plan tier once you authenticate.
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="modal-overlay">
          <div className="glass-panel modal-content" style={{ boxShadow: '0 0 30px rgba(255,59,48,0.15)' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '12px' }}>Confirm Profile Switch</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '24px', lineHeight: '1.5' }}>
              OpenAI Codex is currently running. We need to close it to safely backup configuration files and prevent session locks. 
              Are you sure you want to close Codex and switch to <strong>{selectedProfile.name}</strong>?
            </p>
            <div className="flex-row" style={{ gap: '12px', justifyContent: 'flex-end' }}>
              <button className="glow-btn" onClick={() => setShowConfirm(false)}>
                Cancel
              </button>
              <button className="glow-btn glow-btn-danger" onClick={triggerSwitch}>
                Close Codex & Switch
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Switching Progress Modal */}
      {switching && (
        <div className="modal-overlay" style={{ zIndex: 2000 }}>
          <div className="glass-panel modal-content" style={{ textAlign: 'center', maxWidth: '360px', padding: '32px' }}>
            <div style={{ fontSize: '32px', marginBottom: '16px' }} className="spin-icon">⚙️</div>
            <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>Swapping Profiles</h3>
            <p style={{ color: 'var(--neon-blue)', fontSize: '13px', fontWeight: 500 }} className="pulse-icon">
              {switchStep}
            </p>
          </div>
        </div>
      )}

    </div>
  );
};
