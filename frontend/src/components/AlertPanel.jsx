import React from 'react';

const SEVERITY_CONFIG = {
  LOW:      { bg: '#22c55e15', border: '#22c55e', icon: '✅', label: 'LOW' },
  MEDIUM:   { bg: '#f59e0b15', border: '#f59e0b', icon: '⚠️', label: 'MEDIUM' },
  HIGH:     { bg: '#ef444415', border: '#ef4444', icon: '🚨', label: 'HIGH' },
  CRITICAL: { bg: '#7c3aed20', border: '#7c3aed', icon: '🔴', label: 'CRITICAL' },
};

const TYPE_LABELS = {
  NO_FACE: 'Face Not Detected',
  MULTIPLE_FACES: 'Multiple Faces',
  LOOKING_AWAY: 'Looking Away',
  LIP_MOVEMENT: 'Talking Detected',
  SUSPICIOUS_OBJECT: 'Object Detected',
  UNKNOWN: 'Unknown Activity'
};

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return '--:--:--'; }
}

export default function AlertPanel({ alerts = [], onClear }) {
  const counts = alerts.reduce((acc, a) => {
    acc[a.severity] = (acc[a.severity] || 0) + 1;
    return acc;
  }, {});

  return (
    <div style={styles.panel}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <span style={styles.title}>🔔 Alert Feed</span>
          <span style={styles.count}>{alerts.length}</span>
        </div>
        {alerts.length > 0 && (
          <button style={styles.clearBtn} onClick={onClear}>Clear</button>
        )}
      </div>

      {/* Summary pills */}
      {alerts.length > 0 && (
        <div style={styles.pills}>
          {Object.entries(counts).map(([sev, n]) => {
            const cfg = SEVERITY_CONFIG[sev] || SEVERITY_CONFIG.MEDIUM;
            return (
              <span key={sev} style={{ ...styles.pill, background: cfg.bg, color: cfg.border, border: `1px solid ${cfg.border}40` }}>
                {cfg.icon} {sev}: {n}
              </span>
            );
          })}
        </div>
      )}

      {/* Feed */}
      <div style={styles.feed}>
        {alerts.length === 0 ? (
          <div style={styles.empty}>
            <span style={{ fontSize: 32 }}>✅</span>
            <p>No violations detected</p>
            <p style={{ fontSize: 12, color: '#475569' }}>Monitoring in progress...</p>
          </div>
        ) : (
          alerts.map((alert, i) => {
            const cfg = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.MEDIUM;
            return (
              <div key={alert.id || i} style={{ ...styles.alertCard, background: cfg.bg, borderLeft: `3px solid ${cfg.border}` }}>
                <div style={styles.alertTop}>
                  <span style={{ ...styles.alertType, color: cfg.border }}>
                    {cfg.icon} {TYPE_LABELS[alert.type] || alert.type}
                  </span>
                  <span style={styles.alertTime}>{formatTime(alert.timestamp)}</span>
                </div>
                <p style={styles.alertMsg}>{alert.message}</p>
                {alert.confidence > 0 && (
                  <div style={styles.confidenceRow}>
                    <span style={{ color: '#64748b', fontSize: 11 }}>Confidence:</span>
                    <div style={styles.confBar}>
                      <div style={{ ...styles.confFill, width: `${alert.confidence}%`, background: cfg.border }} />
                    </div>
                    <span style={{ color: cfg.border, fontSize: 11, fontWeight: 700 }}>{alert.confidence}%</span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

const styles = {
  panel: { display: 'flex', flexDirection: 'column', background: '#1a1d27', borderRadius: 12, border: '1px solid #2e3347', overflow: 'hidden', height: '100%' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid #2e3347' },
  title: { fontSize: 14, fontWeight: 700, color: '#e2e8f0' },
  count: { marginLeft: 8, background: '#6366f1', color: '#fff', borderRadius: 10, padding: '1px 8px', fontSize: 11, fontWeight: 700 },
  clearBtn: { background: 'none', border: '1px solid #2e3347', borderRadius: 6, color: '#64748b', padding: '4px 12px', fontSize: 12, cursor: 'pointer' },
  pills: { display: 'flex', gap: 6, padding: '10px 16px', flexWrap: 'wrap' },
  pill: { borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 600 },
  feed: { flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8, color: '#64748b', fontSize: 14 },
  alertCard: { borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4 },
  alertTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  alertType: { fontSize: 12, fontWeight: 700 },
  alertTime: { fontSize: 11, color: '#475569' },
  alertMsg: { fontSize: 12, color: '#cbd5e1' },
  confidenceRow: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 },
  confBar: { flex: 1, height: 4, background: '#1e293b', borderRadius: 2, overflow: 'hidden' },
  confFill: { height: '100%', borderRadius: 2, transition: 'width 0.3s' }
};
