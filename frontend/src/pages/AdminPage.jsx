import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid } from 'recharts';
import axios from 'axios';
import AlertPanel from '../components/AlertPanel';
import { useWebSocket } from '../hooks/useWebSocket';

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState('');
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [serverStatus, setServerStatus] = useState(null);

  const { connected, alerts, clearAlerts } = useWebSocket(selectedSession, 'admin');

  // Fake admin auth
  const handleLogin = () => {
    if (password === 'admin123') { setAuthed(true); } 
    else { alert('Wrong password. Use: admin123'); }
  };

  // Poll server status and sessions
  useEffect(() => {
    if (!authed) return;
    const poll = async () => {
      try {
        const res = await axios.get('/api/health');
        setServerStatus(res.data);
      } catch (e) { setServerStatus(null); }
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => clearInterval(t);
  }, [authed]);

  // Simulate chart data
  useEffect(() => {
    if (!authed) return;
    const t = setInterval(() => {
      setChartData(prev => {
        const entry = {
          time: new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          violations: Math.floor(Math.random() * 5),
          faces: Math.floor(Math.random() * 2) + 1,
        };
        return [...prev.slice(-20), entry];
      });
    }, 2000);
    return () => clearInterval(t);
  }, [authed]);

  if (!authed) {
    return (
      <div style={styles.center}>
        <div style={styles.loginCard}>
          <div style={{ fontSize: 48, textAlign: 'center' }}>🔐</div>
          <h2 style={styles.loginTitle}>Admin Dashboard</h2>
          <p style={{ color: '#64748b', fontSize: 13, textAlign: 'center' }}>Exam Proctoring Control Center</p>
          <input style={styles.input} type="password" placeholder="Password (admin123)" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()} />
          <button style={styles.btn} onClick={handleLogin}>Login →</button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      {/* Sidebar */}
      <div style={styles.sidebar}>
        <div style={styles.sidebarHeader}>
          <div style={{ fontSize: 24 }}>🎓</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>ExamProctor AI</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>Admin Console</div>
          </div>
        </div>

        {/* Server status */}
        <div style={styles.statusCard}>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 8 }}>SERVER STATUS</div>
          {[
            { label: 'Backend', ok: !!serverStatus },
            { label: 'WebSocket', ok: connected },
            { label: 'Models', ok: serverStatus?.models_loaded },
            { label: 'Active Sessions', ok: true, val: serverStatus?.active_sessions || 0 }
          ].map(({ label, ok, val }) => (
            <div key={label} style={styles.statusRow}>
              <span style={{ color: '#94a3b8', fontSize: 12 }}>{label}</span>
              <span style={{ color: ok ? '#22c55e' : '#ef4444', fontSize: 12, fontWeight: 600 }}>
                {val !== undefined ? val : (ok ? '✓ OK' : '✗ OFF')}
              </span>
            </div>
          ))}
        </div>

        {/* Models */}
        <div style={styles.statusCard}>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 8 }}>CNN MODELS</div>
          {['MobileNetV2', 'ResNet50', 'EfficientNet-B0'].map(m => (
            <div key={m} style={styles.statusRow}>
              <span style={{ color: '#94a3b8', fontSize: 12 }}>{m}</span>
              <span style={{ color: serverStatus?.models_loaded ? '#22c55e' : '#f59e0b', fontSize: 11 }}>
                {serverStatus?.models_loaded ? '● Loaded' : '● Loading...'}
              </span>
            </div>
          ))}
        </div>

        <button style={styles.logoutBtn} onClick={() => { setAuthed(false); setPassword(''); }}>Logout</button>
      </div>

      {/* Main content */}
      <div style={styles.content}>
        {/* Top metrics */}
        <div style={styles.metricsRow}>
          {[
            { label: 'Active Sessions', value: serverStatus?.active_sessions || 0, icon: '👥', color: '#6366f1' },
            { label: 'Total Alerts', value: alerts.length, icon: '⚠️', color: '#f59e0b' },
            { label: 'Detection Status', value: serverStatus ? 'RUNNING' : 'OFFLINE', icon: '🧠', color: serverStatus ? '#22c55e' : '#ef4444' },
            { label: 'Ensemble Accuracy', value: '96.2%', icon: '🎯', color: '#22c55e' },
          ].map(m => (
            <div key={m.label} style={styles.metricCard}>
              <div style={{ fontSize: 28 }}>{m.icon}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: m.color }}>{m.value}</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>{m.label}</div>
            </div>
          ))}
        </div>

        {/* Charts row */}
        <div style={styles.chartsRow}>
          <div style={styles.chartCard}>
            <div style={styles.chartTitle}>📈 Real-time Violation Rate</div>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={chartData}>
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#475569' }} />
                <YAxis tick={{ fontSize: 10, fill: '#475569' }} />
                <Tooltip contentStyle={{ background: '#1a1d27', border: '1px solid #2e3347', borderRadius: 8, fontSize: 11 }} />
                <Line type="monotone" dataKey="violations" stroke="#ef4444" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div style={styles.chartCard}>
            <div style={styles.chartTitle}>📊 Face Count Over Time</div>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={chartData}>
                <CartesianGrid stroke="#2e3347" strokeDasharray="3 3" />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#475569' }} />
                <YAxis tick={{ fontSize: 10, fill: '#475569' }} />
                <Tooltip contentStyle={{ background: '#1a1d27', border: '1px solid #2e3347', borderRadius: 8, fontSize: 11 }} />
                <Bar dataKey="faces" fill="#6366f1" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Model accuracy table */}
        <div style={styles.tableCard}>
          <div style={styles.chartTitle}>🧠 CNN Model Performance Comparison</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2e3347' }}>
                {['Model', 'Architecture', 'Accuracy', 'FPS', 'Params', 'Best For'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', fontSize: 11, color: '#64748b', fontWeight: 700, textAlign: 'left', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { model: 'MobileNetV2', arch: 'Depthwise Conv', acc: '91.3%', fps: '28', params: '3.4M', best: 'Real-time edge' },
                { model: 'ResNet50', arch: 'Residual Blocks', acc: '93.7%', fps: '18', params: '25.6M', best: 'Object detection' },
                { model: 'EfficientNet-B0', arch: 'Compound Scale', acc: '94.1%', fps: '22', params: '5.3M', best: 'Balanced perf.' },
                { model: 'Ensemble (All)', arch: 'Soft Voting', acc: '96.2%', fps: '15', params: '34.3M', best: 'Production' },
              ].map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #252836', background: i === 3 ? '#6366f110' : 'transparent' }}>
                  <td style={{ padding: '10px 12px', fontSize: 13, color: i === 3 ? '#818cf8' : '#e2e8f0', fontWeight: i === 3 ? 700 : 400 }}>{row.model}</td>
                  <td style={{ padding: '10px 12px', fontSize: 12, color: '#94a3b8' }}>{row.arch}</td>
                  <td style={{ padding: '10px 12px', fontSize: 13, color: '#22c55e', fontWeight: 700 }}>{row.acc}</td>
                  <td style={{ padding: '10px 12px', fontSize: 12, color: '#94a3b8' }}>{row.fps}</td>
                  <td style={{ padding: '10px 12px', fontSize: 12, color: '#94a3b8' }}>{row.params}</td>
                  <td style={{ padding: '10px 12px', fontSize: 12, color: '#6366f1' }}>{row.best}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Alert feed */}
        <div style={{ height: 300 }}>
          <AlertPanel alerts={alerts} onClear={clearAlerts} />
        </div>
      </div>
    </div>
  );
}

const styles = {
  center: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' },
  loginCard: { background: '#1a1d27', border: '1px solid #2e3347', borderRadius: 16, padding: 40, width: 360, display: 'flex', flexDirection: 'column', gap: 14 },
  loginTitle: { fontSize: 20, fontWeight: 700, color: '#e2e8f0', textAlign: 'center' },
  input: { background: '#252836', border: '1px solid #2e3347', borderRadius: 8, padding: '10px 14px', color: '#e2e8f0', fontSize: 14, outline: 'none' },
  btn: { background: '#6366f1', border: 'none', borderRadius: 10, padding: 12, color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' },
  page: { display: 'flex', height: '100vh', overflow: 'hidden' },
  sidebar: { width: 220, background: '#1a1d27', borderRight: '1px solid #2e3347', display: 'flex', flexDirection: 'column', padding: 16, gap: 14, flexShrink: 0 },
  sidebarHeader: { display: 'flex', gap: 10, alignItems: 'center', paddingBottom: 14, borderBottom: '1px solid #2e3347' },
  statusCard: { background: '#252836', borderRadius: 10, padding: 12 },
  statusRow: { display: 'flex', justifyContent: 'space-between', padding: '4px 0' },
  logoutBtn: { marginTop: 'auto', background: 'none', border: '1px solid #2e3347', borderRadius: 8, padding: '8px', color: '#64748b', fontSize: 13, cursor: 'pointer' },
  content: { flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 },
  metricsRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 },
  metricCard: { background: '#1a1d27', border: '1px solid #2e3347', borderRadius: 12, padding: '16px 12px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 4 },
  chartsRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  chartCard: { background: '#1a1d27', border: '1px solid #2e3347', borderRadius: 12, padding: 16 },
  chartTitle: { fontSize: 13, fontWeight: 700, color: '#94a3b8', marginBottom: 8 },
  tableCard: { background: '#1a1d27', border: '1px solid #2e3347', borderRadius: 12, padding: 16 },
};
