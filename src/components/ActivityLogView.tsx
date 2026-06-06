import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface LogEntry {
  timestamp: string;
  action: string;
  message: string;
}

export const ActivityLogView: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const list = await invoke<LogEntry[]>('get_activity_logs');
      // Sort logs by timestamp descending
      const sorted = list.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      setLogs(sorted);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
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

  const getActionBadgeColor = (action: string) => {
    const act = action.toLowerCase();
    if (act.includes('switch')) return '#00f0ff'; // neon blue
    if (act.includes('restore') || act.includes('backup')) return '#34c759'; // emerald green
    if (act.includes('security')) return '#a855f7'; // purple
    if (act.includes('delete') || act.includes('terminate')) return '#ff3b30'; // red
    return 'var(--text-secondary)';
  };

  return (
    <div className="view-container">
      
      {/* Header */}
      <div className="flex-row" style={{ justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700 }}>Activity Audit Logs</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: '4px' }}>
            Chronological log of profile swaps, backup restorations, and system launches
          </p>
        </div>
        <button className="glow-btn" onClick={fetchLogs}>
          🔄 Refresh Logs
        </button>
      </div>

      {loading ? (
        <div className="glass-card flex-col" style={{ padding: '40px', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: '24px' }} className="spin-icon">⏳</div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '12px' }}>
            Reading activity logs...
          </p>
        </div>
      ) : logs.length === 0 ? (
        <div className="glass-card flex-col" style={{ padding: '60px', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <span style={{ fontSize: '48px', marginBottom: '16px' }}>📋</span>
          <h3 style={{ fontSize: '16px', fontWeight: 600 }}>No Activity Logs</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '6px' }}>
            Switch profiles or create backups to populate logs.
          </p>
        </div>
      ) : (
        <div className="glass-card" style={{ padding: '20px', background: 'rgba(25, 25, 35, 0.2)' }}>
          <div className="flex-col" style={{ gap: '20px' }}>
            {logs.map((log, index) => (
              <div
                key={index}
                className="flex-row"
                style={{
                  alignItems: 'flex-start',
                  gap: '16px',
                  borderBottom: index < logs.length - 1 ? '1px solid var(--border-color)' : 'none',
                  paddingBottom: index < logs.length - 1 ? '16px' : '0',
                }}
              >
                {/* Timeline node */}
                <div
                  style={{
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    background: getActionBadgeColor(log.action),
                    boxShadow: '0 0 8px ' + getActionBadgeColor(log.action),
                    marginTop: '5px',
                    flexShrink: 0,
                  }}
                />

                <div className="flex-col" style={{ gap: '4px', flex: 1 }}>
                  <div className="flex-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: getActionBadgeColor(log.action) }}>
                      {log.action}
                    </span>
                    <span style={{ fontSize: '12px', color: 'var(--text-dark)' }}>
                      {formatTimestamp(log.timestamp)}
                    </span>
                  </div>
                  <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                    {log.message}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div
        className="glass-card flex-row"
        style={{
          marginTop: '24px',
          padding: '12px 16px',
          background: 'rgba(255, 255, 255, 0.02)',
          gap: '8px',
        }}
      >
        <span style={{ fontSize: '16px' }}>🛡️</span>
        <span style={{ fontSize: '12px', color: 'var(--text-dark)' }}>
          Security Assurance: Activity logging is purely local. Tokens, credentials, and passwords are strictly excluded from these audit entries.
        </span>
      </div>

    </div>
  );
};
