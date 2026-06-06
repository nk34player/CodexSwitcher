import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Profile } from '../App';

interface ProfilesViewProps {
  profiles: Profile[];
  activeProfileId: string | null;
  onSaveProfile: (profile: Profile, copyActiveSettings: boolean) => Promise<void>;
  onDeleteProfile: (profileId: string) => Promise<void>;
  onSwitchProfile: (profileId: string) => Promise<void>;
}

const COLORS = [
  '#00f0ff', // Neon Blue
  '#a855f7', // Cyber Purple
  '#10b981', // Emerald
  '#f59e0b', // Amber Gold
  '#ef4444', // Coral Red
  '#6366f1', // Indigo
  '#ec4899', // Pink Glow
  '#71717a', // Slate Grey
];

const EMOJIS = ['💻', '🧠', '⚙️', '🚀', '👤', '🧪', '🛡️', '🌐', '💼', '⚡', '🤖', '👾'];

const getLimitForPlan = (plan: string): number => {
  const p = plan.toLowerCase();
  if (p === 'pro') return 400;
  if (p === 'plus') return 150;
  if (p === 'team' || p === 'enterprise') return 1000;
  return 15; // default/free
};

export const ProfilesView: React.FC<ProfilesViewProps> = ({
  profiles,
  activeProfileId,
  onSaveProfile,
  onDeleteProfile,
  onSwitchProfile
}) => {
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [name, setName] = useState('');
  const [avatarColor, setAvatarColor] = useState(COLORS[0]);
  const [avatarEmoji, setAvatarEmoji] = useState(EMOJIS[0]);
  const [isDefault, setIsDefault] = useState(false);
  const [copyActiveSettings, setCopyActiveSettings] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sharesConfigWith, setSharesConfigWith] = useState<string | null>(null);
  const [profileAnalytics, setProfileAnalytics] = useState<Record<string, {
    plan: string;
    daily_requests: number;
    live_primary_used_percent?: number | null;
    live_primary_reset_at?: number | null;
    live_secondary_used_percent?: number | null;
    live_secondary_reset_at?: number | null;
  }>>({});
  const [refreshingProfiles, setRefreshingProfiles] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const fetchAllAnalytics = async () => {
      try {
        const promises = profiles.map(async (p) => {
          try {
            const res = await invoke<any>('get_profile_analytics', { profileId: p.id });
            return {
              id: p.id,
              analytics: {
                plan: res.plan || p.plan || 'free',
                daily_requests: res.daily_requests || 0,
                live_primary_used_percent: res.live_primary_used_percent,
                live_primary_reset_at: res.live_primary_reset_at,
                live_secondary_used_percent: res.live_secondary_used_percent,
                live_secondary_reset_at: res.live_secondary_reset_at,
              }
            };
          } catch (err) {
            console.error('Failed to fetch analytics for ' + p.name, err);
            return {
              id: p.id,
              analytics: {
                plan: p.plan || 'free',
                daily_requests: 0,
              }
            };
          }
        });
        
        const results = await Promise.all(promises);
        const newData: Record<string, any> = {};
        for (const item of results) {
          newData[item.id] = item.analytics;
        }
        setProfileAnalytics(newData);
      } catch (err) {
        console.error('Error fetching all analytics:', err);
      }
    };

    if (profiles.length > 0) {
      fetchAllAnalytics();
    }
  }, [profiles]);

  useEffect(() => {
    let unlistenFn: (() => void) | undefined;
    
    const setupListener = async () => {
      const unsub = await listen<any>('profile-analytics-updated', (event) => {
        const { profile_id, analytics } = event.payload;
        setProfileAnalytics((prev) => ({
          ...prev,
          [profile_id]: {
            plan: analytics.plan || 'free',
            daily_requests: analytics.daily_requests || 0,
            live_primary_used_percent: analytics.live_primary_used_percent,
            live_primary_reset_at: analytics.live_primary_reset_at,
            live_secondary_used_percent: analytics.live_secondary_used_percent,
            live_secondary_reset_at: analytics.live_secondary_reset_at,
          }
        }));
      });
      unlistenFn = unsub;
    };
    
    setupListener();
    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, []);

  const setProfileRefreshing = (profileId: string, refreshing: boolean) => {
    setRefreshingProfiles((prev) => ({
      ...prev,
      [profileId]: refreshing,
    }));
  };

  const handleRefreshProfile = (profileId: string) => {
    setProfileRefreshing(profileId, true);

    invoke<any>('refresh_profile', { profileId })
      .then((res) => {
        setProfileAnalytics((prev) => ({
          ...prev,
          [profileId]: {
            plan: res.plan || 'free',
            daily_requests: res.daily_requests || 0,
            live_primary_used_percent: res.live_primary_used_percent,
            live_primary_reset_at: res.live_primary_reset_at,
            live_secondary_used_percent: res.live_secondary_used_percent,
            live_secondary_reset_at: res.live_secondary_reset_at,
          }
        }));
      })
      .catch((err) => {
        console.error('Failed to refresh analytics for profile ' + profileId, err);
      })
      .finally(() => {
        setProfileRefreshing(profileId, false);
      });
  };

  const handleCreateNew = () => {
    setIsNew(true);
    setEditingProfile({
      id: 'p_' + Math.random().toString(36).substring(2, 11),
      name: '',
      avatar_color: COLORS[0],
      avatar_emoji: EMOJIS[0],
      is_default: profiles.length === 0,
    });
    setName('');
    setAvatarColor(COLORS[0]);
    setAvatarEmoji(EMOJIS[0]);
    setIsDefault(profiles.length === 0);
    setCopyActiveSettings(true);
    setSharesConfigWith(null);
  };

  const handleEdit = (profile: Profile) => {
    setIsNew(false);
    setEditingProfile(profile);
    setName(profile.name);
    setAvatarColor(profile.avatar_color);
    setAvatarEmoji(profile.avatar_emoji);
    setIsDefault(profile.is_default);
    setSharesConfigWith(profile.shares_config_with || null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProfile || !name.trim()) return;

    setSaving(true);
    try {
      const updatedProfile: Profile = {
        ...editingProfile,
        name: name.trim(),
        avatar_color: avatarColor,
        avatar_emoji: avatarEmoji,
        is_default: isDefault,
        shares_config_with: sharesConfigWith ? sharesConfigWith : null,
      };
      
      await onSaveProfile(updatedProfile, isNew ? copyActiveSettings : false);
      setEditingProfile(null);
    } catch (err) {
      alert('Failed to save profile: ' + err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (profileId: string) => {
    if (profileId === activeProfileId) {
      alert('Cannot delete the currently active profile. Switch to another profile first.');
      return;
    }
    
    if (confirm('Are you sure you want to delete this profile? All associated config files, databases, and stored logins will be permanently erased.')) {
      try {
        await onDeleteProfile(profileId);
      } catch (err) {
        alert('Failed to delete profile: ' + err);
      }
    }
  };

  return (
    <div className="view-container">
      
      {/* Header */}
      <div className="flex-row" style={{ justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700 }}>Profile Command Center</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: '4px' }}>
            Configure and manage multiple OpenAI Codex identities
          </p>
        </div>
        <button className="glow-btn glow-btn-primary" onClick={handleCreateNew}>
          ➕ Add New Profile
        </button>
      </div>

      {/* Profiles list */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '20px',
        }}
      >
        {profiles.map((profile) => {
          const isActive = profile.id === activeProfileId;
          const isRefreshing = !!refreshingProfiles[profile.id];
          const canRefreshProfile = !!profile.email;
          return (
            <div
              key={profile.id}
              className="glass-card flex-col"
              style={{
                padding: '20px',
                gap: '16px',
                borderColor: isActive ? 'var(--neon-blue)' : 'var(--border-color)',
                boxShadow: isActive ? '0 0 15px rgba(0, 240, 255, 0.1)' : 'none',
              }}
            >
              <div className="flex-row" style={{ gap: '14px' }}>
                <div
                  style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '10px',
                    background: profile.avatar_color,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '24px',
                  }}
                >
                  {profile.avatar_emoji}
                </div>
                
                <div className="flex-col" style={{ gap: '2px', flex: 1, overflow: 'hidden' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {profile.name}
                  </h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-dark)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {profile.email || 'No login cached'}
                  </p>
                </div>
              </div>

              <div className="flex-row" style={{ gap: '8px', flexWrap: 'wrap' }}>
                {isActive && (
                  <span style={{ fontSize: '11px', background: 'rgba(0, 240, 255, 0.15)', color: 'var(--neon-blue)', padding: '2px 8px', borderRadius: '10px', fontWeight: 600 }}>
                    ACTIVE
                  </span>
                )}
                {profile.is_default && (
                  <span style={{ fontSize: '11px', background: 'rgba(255, 255, 255, 0.08)', color: 'var(--text-secondary)', padding: '2px 8px', borderRadius: '10px', fontWeight: 600 }}>
                    DEFAULT
                  </span>
                )}
                {profile.plan && profile.email && (
                  <span style={{ fontSize: '11px', background: 'rgba(168, 85, 247, 0.1)', color: '#c084fc', padding: '2px 8px', borderRadius: '10px', fontWeight: 600 }}>
                    {profile.plan.toUpperCase()}
                  </span>
                )}
                {profile.shares_config_with && (() => {
                  const target = profiles.find(p => p.id === profile.shares_config_with);
                  return (
                    <span style={{ fontSize: '11px', background: 'rgba(52, 199, 89, 0.15)', color: '#34c759', padding: '2px 8px', borderRadius: '10px', fontWeight: 600 }}>
                      🔗 SHARED WITH: {target ? target.name.toUpperCase() : 'UNKNOWN'}
                    </span>
                  );
                })()}
              </div>

              {/* Remaining Usage */}
              {profileAnalytics[profile.id] && profile.email ? (
                <div 
                  className="flex-col" 
                  style={{ 
                    gap: '6px', 
                    width: '100%', 
                    background: 'rgba(0, 0, 0, 0.15)', 
                    padding: '10px 12px', 
                    borderRadius: '8px', 
                    border: '1px solid rgba(255, 255, 255, 0.03)',
                    marginTop: '4px',
                    minHeight: '102px',
                    justifyContent: 'center'
                  }}
                >
                  {isRefreshing ? (
                    <div className="profile-loader-shell">
                      <div className="profile-refresh-spinner" aria-label="Refreshing profile analytics" />
                      <div className="profile-refresh-text">Refreshing local profile analytics...</div>
                    </div>
                  ) : (
                    <>
                      <div className="flex-row" style={{ justifyContent: 'space-between', fontSize: '11px' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Remaining Today:</span>
                        <strong style={{ color: 'var(--neon-blue)' }}>
                          {(() => {
                            const analytics = profileAnalytics[profile.id];
                            if (analytics.live_primary_used_percent !== undefined && analytics.live_primary_used_percent !== null) {
                              return `${100 - analytics.live_primary_used_percent}%`;
                            }
                            const plan = analytics.plan || 'free';
                            const limit = getLimitForPlan(plan);
                            const daily = analytics.daily_requests || 0;
                            return `${Math.max(0, limit - daily)} / ${limit}`;
                          })()}
                        </strong>
                      </div>
                      <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', overflow: 'hidden' }}>
                        <div 
                          style={{ 
                            height: '100%', 
                            width: (() => {
                              const analytics = profileAnalytics[profile.id];
                              if (analytics.live_primary_used_percent !== undefined && analytics.live_primary_used_percent !== null) {
                                return `${100 - analytics.live_primary_used_percent}%`;
                              }
                              const plan = analytics.plan || 'free';
                              const limit = getLimitForPlan(plan);
                              const daily = analytics.daily_requests || 0;
                              return `${Math.max(0, Math.min(100, ((limit - daily) / limit) * 100))}%`;
                            })(), 
                            background: (() => {
                              const analytics = profileAnalytics[profile.id];
                              let pct = 0;
                              if (analytics.live_primary_used_percent !== undefined && analytics.live_primary_used_percent !== null) {
                                pct = 100 - analytics.live_primary_used_percent;
                              } else {
                                const plan = analytics.plan || 'free';
                                const limit = getLimitForPlan(plan);
                                const daily = analytics.daily_requests || 0;
                                pct = ((limit - daily) / limit) * 100;
                              }
                              return pct > 50 ? '#00f0ff' : pct > 20 ? '#ff9f0a' : '#ff3b30';
                            })(),
                            transition: 'width 0.3s ease'
                          }} 
                        />
                      </div>
                      {profileAnalytics[profile.id]?.live_secondary_used_percent !== undefined && profileAnalytics[profile.id]?.live_secondary_used_percent !== null && (
                        <div className="flex-col" style={{ gap: '4px', marginTop: '6px' }}>
                          <div className="flex-row" style={{ justifyContent: 'space-between', fontSize: '11px' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>Remaining Weekly:</span>
                            <strong style={{ color: '#c084fc' }}>
                              {100 - profileAnalytics[profile.id].live_secondary_used_percent!}%
                            </strong>
                          </div>
                          <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', overflow: 'hidden' }}>
                            <div 
                              style={{ 
                                height: '100%', 
                                width: `${100 - profileAnalytics[profile.id].live_secondary_used_percent!}%`, 
                                background: '#c084fc',
                                transition: 'width 0.3s ease'
                              }} 
                            />
                          </div>
                        </div>
                      )}
                      {(() => {
                        const resetAt = profileAnalytics[profile.id]?.live_primary_reset_at;
                        if (!resetAt) return null;
                        return (
                          <div style={{ fontSize: '9px', color: 'var(--text-dark)', marginTop: '2px', textAlign: 'right' }}>
                            Resets at {new Date(resetAt * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                          </div>
                        );
                      })()}
                    </>
                  )}
                </div>
              ) : (
                <div 
                  className="flex-col" 
                  style={{ 
                    gap: '4px', 
                    width: '100%', 
                    background: 'rgba(255, 159, 10, 0.03)', 
                    padding: '10px 12px', 
                    borderRadius: '8px', 
                    border: '1px solid rgba(255, 159, 10, 0.1)',
                    marginTop: '4px',
                    fontSize: '11px',
                    color: 'var(--text-secondary)'
                  }}
                >
                  🔒 <strong>Login Required</strong>
                  <div style={{ fontSize: '10px', color: 'var(--text-dark)', marginTop: '2px' }}>
                    Start Codex with this profile to sign in and trace live limits.
                  </div>
                </div>
              )}

              <div className="flex-row" style={{ gap: '10px', marginTop: '4px' }}>
                {canRefreshProfile && (
                  <button
                    className="glow-btn"
                    style={{ padding: '6px 12px', fontSize: '12px' }}
                    onClick={() => handleRefreshProfile(profile.id)}
                    disabled={isRefreshing}
                  >
                    {isRefreshing ? '⏳ Refreshing' : '🔄 Refresh'}
                  </button>
                )}
                {!isActive && (
                  <button
                    className="glow-btn glow-btn-primary"
                    style={{ padding: '6px 12px', fontSize: '12px' }}
                    onClick={() => onSwitchProfile(profile.id)}
                  >
                    🔒 Switch Profile
                  </button>
                )}
                <button className="glow-btn" style={{ flex: 1, padding: '6px 12px', fontSize: '12px' }} onClick={() => handleEdit(profile)}>
                  ✏️ Edit Profile
                </button>
                {!isActive && (
                  <button className="glow-btn glow-btn-danger" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => handleDelete(profile.id)}>
                    🗑️ Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Editor Modal */}
      {editingProfile && (
        <div className="modal-overlay">
          <form
            onSubmit={handleSave}
            className="glass-panel modal-content"
            style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}
          >
            <h2 style={{ fontSize: '18px', fontWeight: 600 }}>
              {isNew ? 'Create New Profile' : 'Edit Profile Settings'}
            </h2>

            <div className="input-group">
              <span className="input-label">Profile Name</span>
              <input
                type="text"
                required
                className="input-field"
                placeholder="e.g. Personal Account, Work (Admin)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={30}
              />
            </div>

            {/* Icon Picker */}
            <div className="input-group">
              <span className="input-label">Avatar Emoji</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px' }}>
                {EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => setAvatarEmoji(emoji)}
                    style={{
                      fontSize: '20px',
                      width: '40px',
                      height: '40px',
                      borderRadius: '8px',
                      border: '1px solid',
                      borderColor: avatarEmoji === emoji ? 'var(--neon-blue)' : 'var(--border-color)',
                      background: avatarEmoji === emoji ? 'rgba(0, 240, 255, 0.1)' : 'rgba(0,0,0,0.2)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>

            {/* Color Picker */}
            <div className="input-group">
              <span className="input-label">Theme Accent Color</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px' }}>
                {COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setAvatarColor(color)}
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      background: color,
                      border: avatarColor === color ? '2px solid #fff' : 'none',
                      boxShadow: avatarColor === color ? '0 0 10px ' + color : 'none',
                      cursor: 'pointer',
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="flex-row" style={{ gap: '10px' }}>
              <input
                type="checkbox"
                id="isDefault"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                style={{ width: '16px', height: '16px', accentColor: 'var(--neon-blue)' }}
              />
              <label htmlFor="isDefault" style={{ fontSize: '14px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                Set as default profile
              </label>
            </div>

            {isNew && (
              <div className="flex-row" style={{ gap: '10px' }}>
                <input
                  type="checkbox"
                  id="copySettings"
                  checked={copyActiveSettings}
                  onChange={(e) => setCopyActiveSettings(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: 'var(--neon-blue)' }}
                />
                <label htmlFor="copySettings" style={{ fontSize: '14px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                  Clone active settings & trusted workspaces (excluding logins)
                </label>
              </div>
            )}

            {/* Share Configuration */}
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span className="input-label">Share App Data & History</span>
              <p style={{ color: 'var(--text-secondary)', fontSize: '12px', margin: 0, marginBottom: '4px' }}>
                Share conversations, settings, and plugins with another profile while keeping logins isolated.
              </p>
              <select
                className="input-field"
                value={sharesConfigWith || ''}
                onChange={(e) => setSharesConfigWith(e.target.value || null)}
                style={{
                  background: 'rgba(0, 0, 0, 0.2)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="">Don't share configs (Full Isolation)</option>
                {profiles
                  .filter((p) => p.id !== editingProfile?.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      Share configs with: {p.name || p.email || p.id}
                    </option>
                  ))}
              </select>
            </div>

            <div className="flex-row" style={{ gap: '12px', justifyContent: 'flex-end', marginTop: '10px' }}>
              <button
                type="button"
                className="glow-btn"
                onClick={() => setEditingProfile(null)}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="glow-btn glow-btn-primary"
                disabled={saving || !name.trim()}
              >
                {saving ? 'Saving...' : 'Save Profile'}
              </button>
            </div>

          </form>
        </div>
      )}

    </div>
  );
};
