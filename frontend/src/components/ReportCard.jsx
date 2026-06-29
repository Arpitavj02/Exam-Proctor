import React from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

const RISK_STYLES = {
  LOW:      { color: '#22c55e', bg: '#22c55e15', label: 'LOW RISK' },
  MEDIUM:   { color: '#f59e0b', bg: '#f59e0b15', label: 'MEDIUM RISK' },
  HIGH:     { color: '#ef4444', bg: '#ef444415', label: 'HIGH RISK' },
  CRITICAL: { color: '#7c3aed', bg: '#7c3aed20', label: 'CRITICAL' },
};

const PIE_COLORS = ['#6366f1', '#ef4444', '#f59e0b', '#22c55e', '#7c3aed'];

export default function ReportCard({ report }) {
  if (!report) return null;

  const risk = RISK_STYLES[report.risk_level] || RISK_STYLES.LOW;
  const pieData = Object.entries(report.violation_breakdown || {}).map(([name, value]) => ({ name, value }));

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <h2 style={styles.title}>📋 Exam Session Report</h2>
        <span style={{ ...styles.riskBadge, background: risk.bg, color: risk.color, border: `1px solid ${risk.color}40` }}>
          {risk.label}
        </span>
      </div>

      <div style={styles.grid}>
        <StatBox label="Student" value={report.student_name} icon="👤" />
        <StatBox label="Exam ID" value={report.exam_id} icon="📝" />
        <StatBox label="Frames Analyzed" value={report.total_frames_analyzed} icon="🎬" />
        <StatBox label="Total Violations" value={report.total_violations} icon="⚠️" color="#ef4444" />
        <StatBox label="Violation Rate" value={`${report.violation_rate_percent}%`} icon="📊" color="#f59e0b" />
        <StatBox label="Risk Score" value={`${report.risk_score}/100`} icon="🎯" color={risk.color} />
      </div>

      {/* Risk gauge */}
      <div style={styles.gaugeSection}>
        <div style={styles.gaugeLabel}>Risk Score</div>
        <div style={styles.gaugeTrack}>
          <div style={{ ...styles.gaugeFill, width: `${report.risk_score}%`, background: risk.color }} />
        </div>
        <span style={{ color: risk.color, fontWeight: 700 }}>{report.risk_score}%</span>
      </div>

      {/* Violation breakdown pie */}
      {pieData.length > 0 && (
        <div style={styles.pieSection}>
          <h3 style={styles.sectionTitle}>Violation Breakdown</h3>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" label={({ name, value }) => `${name}: ${value}`} labelLine={false} style={{ fontSize: 11 }}>
                {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: '#1a1d27', border: '1px solid #2e3347', borderRadius: 8, fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Recommendation */}
      <div style={{ ...styles.recommendation, background: risk.bg, borderLeft: `4px solid ${risk.color}` }}>
        <strong style={{ color: risk.color }}>Recommendation:</strong>
        <p style={{ color: '#cbd5e1', fontSize: 13, marginTop: 4 }}>{report.recommendation}</p>
      </div>
    </div>
  );
}

function StatBox({ label, value, icon, color }) {
  return (
    <div style={styles.statBox}>
      <span style={styles.statIcon}>{icon}</span>
      <div style={{ ...styles.statValue, color: color || '#e2e8f0' }}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  );
}

const styles = {
  card: { background: '#1a1d27', borderRadius: 12, border: '1px solid #2e3347', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 16, fontWeight: 700, color: '#e2e8f0' },
  riskBadge: { borderRadius: 20, padding: '4px 14px', fontSize: 12, fontWeight: 700, letterSpacing: 1 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 },
  statBox: { background: '#252836', borderRadius: 10, padding: '12px 10px', textAlign: 'center' },
  statIcon: { fontSize: 20 },
  statValue: { fontSize: 18, fontWeight: 700, marginTop: 4 },
  statLabel: { fontSize: 11, color: '#64748b', marginTop: 2 },
  gaugeSection: { display: 'flex', alignItems: 'center', gap: 10 },
  gaugeLabel: { fontSize: 12, color: '#64748b', minWidth: 70 },
  gaugeTrack: { flex: 1, height: 8, background: '#252836', borderRadius: 4, overflow: 'hidden' },
  gaugeFill: { height: '100%', borderRadius: 4, transition: 'width 0.5s' },
  pieSection: {},
  sectionTitle: { fontSize: 13, fontWeight: 600, color: '#94a3b8', marginBottom: 8 },
  recommendation: { borderRadius: 8, padding: '12px 16px' }
};
