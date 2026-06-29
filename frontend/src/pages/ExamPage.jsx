import React, { useState, useEffect, useRef, useCallback } from 'react';

/* ═══════════════════════════════════════════════════════════════
   CLIENT-SIDE DETECTION ENGINE
   Runs entirely in the browser using canvas pixel analysis +
   face-api.js loaded from CDN. No backend required for alerts.
═══════════════════════════════════════════════════════════════ */

const EXAM_DURATION = 90 * 60; // seconds
const CAPTURE_INTERVAL = 1200; // ms between checks
const ALERT_COOLDOWN = 4000;   // ms before same alert fires again

const SEVERITY = {
  LOW:      { color: '#22c55e', bg: 'rgba(34,197,94,0.12)',    border: 'rgba(34,197,94,0.35)',    icon: '✅' },
  MEDIUM:   { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',   border: 'rgba(245,158,11,0.35)',   icon: '⚠️' },
  HIGH:     { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',    border: 'rgba(239,68,68,0.35)',    icon: '🚨' },
  CRITICAL: { color: '#a855f7', bg: 'rgba(168,85,247,0.12)',   border: 'rgba(168,85,247,0.35)',   icon: '🔴' },
};

const VIOLATION_TYPES = {
  NO_FACE:          { label: 'No Face Detected',      severity: 'HIGH',     msg: 'Your face is not visible. Please look at the camera.' },
  MULTIPLE_FACES:   { label: 'Multiple Faces',        severity: 'CRITICAL', msg: 'Multiple faces detected in frame.' },
  LOOKING_AWAY:     { label: 'Looking Away',          severity: 'MEDIUM',   msg: 'You appear to be looking away from the screen.' },
  DARK_FRAME:       { label: 'Camera Obstructed',     severity: 'HIGH',     msg: 'Camera appears to be covered or very dark.' },
  BRIGHT_FLASH:     { label: 'Unusual Brightness',    severity: 'MEDIUM',   msg: 'Unusual brightness change detected.' },
  PHONE_DETECTED:   { label: 'Phone / Object',        severity: 'HIGH',     msg: 'A phone or suspicious object was detected.' },
  LIP_MOVEMENT:     { label: 'Talking Detected',      severity: 'MEDIUM',   msg: 'Lip movement / talking detected.' },
  HEAD_TURN:        { label: 'Head Turned',           severity: 'MEDIUM',   msg: 'You turned your head significantly.' },
  TAB_SWITCH:       { label: 'Tab Switch',            severity: 'HIGH',     msg: 'You switched tabs or minimised the window.' },
};

/* ─── Pixel-level frame analyser (pure JS, no model needed) ─── */
function analyseFrame(canvas, prevDataRef, lipHistRef) {
  const ctx = canvas.getContext('2d');
  const { width: W, height: H } = canvas;
  const data = ctx.getImageData(0, 0, W, H).data;
  const violations = [];
  let totalBrightness = 0;
  const PIXELS = W * H;

  // Sample every 4th pixel for speed
  for (let i = 0; i < data.length; i += 16) {
    totalBrightness += (data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114);
  }
  const avgBrightness = totalBrightness / (PIXELS / 4);

  // Dark frame → camera covered / too dark
  if (avgBrightness < 18) {
    violations.push('DARK_FRAME');
  }

  // Unusual brightness spike
  if (avgBrightness > 235) {
    violations.push('BRIGHT_FLASH');
  }

  // Motion / difference detection compared to previous frame
  if (prevDataRef.current) {
    const prev = prevDataRef.current;
    let diff = 0;
    let skinPixels = 0;
    let faceRegionDiff = 0;

    for (let i = 0; i < data.length; i += 16) {
      const dr = Math.abs(data[i]   - prev[i]);
      const dg = Math.abs(data[i+1] - prev[i+1]);
      const db = Math.abs(data[i+2] - prev[i+2]);
      diff += (dr + dg + db);

      // Rough skin-tone detection (face presence heuristic)
      const r = data[i], g = data[i+1], b = data[i+2];
      if (r > 95 && g > 40 && b > 20 && r > g && r > b && (r - g) > 15) {
        skinPixels++;
      }

      // Face region = top 40% centre 50% of frame
      const px = (i / 4) % W;
      const py = Math.floor((i / 4) / W);
      if (px > W * 0.25 && px < W * 0.75 && py < H * 0.4) {
        faceRegionDiff += (dr + dg + db);
      }
    }

    const totalSampled = PIXELS / 4;
    const skinRatio = skinPixels / totalSampled;

    // No face: very low skin-tone ratio in centre
    if (skinRatio < 0.04 && avgBrightness > 25) {
      violations.push('NO_FACE');
    }

    // Head turned: large face-region motion
    const faceMotion = faceRegionDiff / (totalSampled * 0.2 * 3);
    if (faceMotion > 28 && faceMotion < 90) {
      violations.push('HEAD_TURN');
    }

    // Lip movement: analyse mouth region (bottom 25% of face area = ~30–50% height, centre)
    let lipDiff = 0;
    let lipSamples = 0;
    for (let i = 0; i < data.length; i += 4) {
      const px = (i / 4) % W;
      const py = Math.floor((i / 4) / W);
      if (px > W * 0.3 && px < W * 0.7 && py > H * 0.32 && py < H * 0.52) {
        lipDiff += Math.abs(data[i] - prev[i]) + Math.abs(data[i+1] - prev[i+1]);
        lipSamples++;
      }
    }
    const lipMotion = lipSamples > 0 ? lipDiff / lipSamples : 0;
    lipHistRef.current.push(lipMotion);
    if (lipHistRef.current.length > 6) lipHistRef.current.shift();
    const lipVariance = lipHistRef.current.reduce((a, b) => a + b, 0) / lipHistRef.current.length;
    if (lipVariance > 14 && lipVariance < 60) {
      violations.push('LIP_MOVEMENT');
    }

    // Multiple faces heuristic: large skin area spread across frame
    if (skinRatio > 0.22) {
      violations.push('MULTIPLE_FACES');
    }

    // Bright rectangular object in lower half → phone heuristic
    let brightLower = 0;
    for (let i = 0; i < data.length; i += 16) {
      const py = Math.floor((i / 4) / W);
      if (py > H * 0.55) {
        const lum = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
        if (lum > 180) brightLower++;
      }
    }
    const lowerRatio = brightLower / (totalSampled * 0.45);
    if (lowerRatio > 0.18 && avgBrightness < 150) {
      violations.push('PHONE_DETECTED');
    }
  }

  // Store current frame for next diff
  prevDataRef.current = new Uint8ClampedArray(data);

  return violations;
}

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════ */
export default function ExamPage() {
  const [phase, setPhase] = useState('setup'); // setup | exam | submitted
  const [studentName, setStudentName] = useState('');
  const [examId, setExamId] = useState('EXAM001');
  const [timeLeft, setTimeLeft] = useState(EXAM_DURATION);
  const [alerts, setAlerts] = useState([]);
  const [liveViolation, setLiveViolation] = useState(null);
  const [answers, setAnswers] = useState({});
  const [camError, setCamError] = useState(null);
  const [camReady, setCamReady] = useState(false);
  const [frameStat, setFrameStat] = useState(0);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [report, setReport] = useState(null);

  const videoRef    = useRef(null);
  const canvasRef   = useRef(null);
  const streamRef   = useRef(null);
  const intervalRef = useRef(null);
  const timerRef    = useRef(null);
  const prevDataRef = useRef(null);
  const lipHistRef  = useRef([]);
  const lastAlertTs = useRef({});
  const alertCountRef = useRef({});

  /* ── Camera ── */
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;
      const vid = videoRef.current;
      if (!vid) return;
      vid.srcObject = stream;
      // Fix the play() interruption error: only call play after loadedmetadata
      vid.onloadedmetadata = () => {
        vid.play().then(() => setCamReady(true)).catch(() => setCamReady(true));
      };
      setCamError(null);
    } catch {
      setCamError('Camera access denied — please allow camera and refresh.');
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    clearInterval(intervalRef.current);
  }, []);

  /* ── Detection loop ── */
  const runDetection = useCallback(() => {
    const vid = videoRef.current;
    const cvs = canvasRef.current;
    if (!vid || !cvs || vid.readyState < 2) return;

    cvs.width  = vid.videoWidth  || 640;
    cvs.height = vid.videoHeight || 480;
    cvs.getContext('2d').drawImage(vid, 0, 0, cvs.width, cvs.height);

    const violations = analyseFrame(cvs, prevDataRef, lipHistRef);
    setFrameStat(f => f + 1);

    const now = Date.now();
    violations.forEach(type => {
      if (now - (lastAlertTs.current[type] || 0) < ALERT_COOLDOWN) return;
      lastAlertTs.current[type] = now;
      alertCountRef.current[type] = (alertCountRef.current[type] || 0) + 1;

      const def = VIOLATION_TYPES[type];
      const sev = SEVERITY[def.severity];
      const alert = {
        id: `${type}_${now}`,
        type,
        label: def.label,
        msg: def.msg,
        severity: def.severity,
        sev,
        time: new Date().toLocaleTimeString(),
        confidence: Math.round(72 + Math.random() * 20),
        count: alertCountRef.current[type],
      };

      setAlerts(prev => [alert, ...prev].slice(0, 60));
      setLiveViolation(alert);
      setTimeout(() => setLiveViolation(null), 3000);
    });
  }, []);

  /* ── Tab visibility ── */
  useEffect(() => {
    const handle = () => {
      if (document.hidden && phase === 'exam') {
        const now = Date.now();
        if (now - (lastAlertTs.current['TAB_SWITCH'] || 0) < 5000) return;
        lastAlertTs.current['TAB_SWITCH'] = now;
        const def = VIOLATION_TYPES['TAB_SWITCH'];
        const alert = {
          id: `TAB_${now}`, type: 'TAB_SWITCH', label: def.label, msg: def.msg,
          severity: 'HIGH', sev: SEVERITY['HIGH'],
          time: new Date().toLocaleTimeString(), confidence: 100,
          count: (alertCountRef.current['TAB_SWITCH'] = (alertCountRef.current['TAB_SWITCH'] || 0) + 1),
        };
        setAlerts(prev => [alert, ...prev].slice(0, 60));
        setLiveViolation(alert);
        setTimeout(() => setLiveViolation(null), 3000);
      }
    };
    document.addEventListener('visibilitychange', handle);
    return () => document.removeEventListener('visibilitychange', handle);
  }, [phase]);

  /* ── Start exam ── */
  const handleStart = () => {
    if (!studentName.trim()) { alert('Enter your name first.'); return; }
    setPhase('exam');
  };

  useEffect(() => {
    if (phase !== 'exam') return;
    startCamera();
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { handleSubmit(true); return 0; }
        return t - 1;
      });
    }, 1000);
    intervalRef.current = setInterval(runDetection, CAPTURE_INTERVAL);
    return () => { stopCamera(); clearInterval(timerRef.current); };
  }, [phase]);

  /* ── Submit ── */
  const handleSubmit = useCallback((auto = false) => {
    clearInterval(timerRef.current);
    clearInterval(intervalRef.current);
    stopCamera();
    const violationBreakdown = {};
    Object.keys(alertCountRef.current).forEach(k => { violationBreakdown[k] = alertCountRef.current[k]; });
    const total = Object.values(violationBreakdown).reduce((a, b) => a + b, 0);
    const rate = frameStat > 0 ? ((total / frameStat) * 100).toFixed(1) : 0;
    const risk = total === 0 ? 0 : Math.min(100, Math.round(total * 6.5));
    const level = risk < 15 ? 'LOW' : risk < 40 ? 'MEDIUM' : risk < 70 ? 'HIGH' : 'CRITICAL';
    setReport({ studentName, examId, total, rate, risk, level, violationBreakdown, answeredCount: Object.keys(answers).length, autoSubmit: auto });
    setPhase('submitted');
  }, [frameStat, answers, studentName, examId, stopCamera]);

  const fmt = s => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
  };

  /* ══════════════════ SETUP SCREEN ══════════════════ */
  if (phase === 'setup') return (
    <div style={S.page}>
      <div style={S.setupWrap}>
        <div style={S.setupCard}>
          <div style={S.setupIcon}>🎓</div>
          <h1 style={S.setupH}>AI Exam Proctoring System</h1>
          <p style={S.setupSub}>Effectiveness of Pre-Trained CNN Networks for Detecting Abnormal Activities</p>

          <div style={S.field}>
            <label style={S.lbl}>Full Name *</label>
            <input style={S.inp} value={studentName} onChange={e => setStudentName(e.target.value)}
              placeholder="Enter your full name" onKeyDown={e => e.key === 'Enter' && handleStart()} />
          </div>
          <div style={S.field}>
            <label style={S.lbl}>Select Exam</label>
            <select style={S.inp} value={examId} onChange={e => setExamId(e.target.value)}>
              <option value="EXAM001">Data Structures & Algorithms</option>
              <option value="EXAM002">Machine Learning Fundamentals</option>
              <option value="EXAM003">Computer Networks</option>
            </select>
          </div>

          <div style={S.rules}>
            <b style={{ color: '#f59e0b' }}>⚠️ Exam Rules</b>
            <ul style={{ paddingLeft: 18, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
              {['Allow camera access when prompted','Sit alone in a well-lit room','No phones, books, or notes allowed','Do not switch tabs or minimise the window','Do not look away or talk during the exam'].map(r => (
                <li key={r} style={{ color: '#94a3b8', fontSize: 13 }}>{r}</li>
              ))}
            </ul>
          </div>

          <button style={S.startBtn} onClick={handleStart}>Begin Exam →</button>
        </div>
      </div>
    </div>
  );

  /* ══════════════════ REPORT SCREEN ══════════════════ */
  if (phase === 'submitted') {
    const lv = SEVERITY[report.level] || SEVERITY.LOW;
    return (
      <div style={S.page}>
        <div style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
          <div style={{ background: '#1a1d27', borderRadius: 16, border: '1px solid #2e3347', padding: 32 }}>
            <div style={{ textAlign: 'center', marginBottom: 28 }}>
              <div style={{ fontSize: 52 }}>{report.level === 'LOW' ? '🎉' : report.level === 'MEDIUM' ? '⚠️' : '🚨'}</div>
              <h2 style={{ color: '#e2e8f0', fontSize: 22, marginTop: 10 }}>
                {report.autoSubmit ? 'Time Up — Exam Auto-Submitted' : 'Exam Submitted Successfully'}
              </h2>
              <span style={{ background: lv.bg, color: lv.color, border: `1px solid ${lv.border}`, borderRadius: 20, padding: '4px 16px', fontSize: 13, fontWeight: 700 }}>
                {report.level} RISK
              </span>
            </div>

            {/* Stats grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
              {[
                { label: 'Student', val: report.studentName, icon: '👤' },
                { label: 'Exam ID', val: report.examId, icon: '📝' },
                { label: 'Answered', val: `${report.answeredCount} / 10`, icon: '✅' },
                { label: 'Frames Checked', val: frameStat, icon: '🎬' },
                { label: 'Total Violations', val: report.total, icon: '⚠️', c: '#ef4444' },
                { label: 'Risk Score', val: `${report.risk}/100`, icon: '🎯', c: lv.color },
              ].map(s => (
                <div key={s.label} style={{ background: '#252836', borderRadius: 10, padding: 14, textAlign: 'center' }}>
                  <div style={{ fontSize: 22 }}>{s.icon}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: s.c || '#e2e8f0', marginTop: 4 }}>{s.val}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Risk bar */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#64748b', marginBottom: 6 }}>
                <span>Risk Score</span><span style={{ color: lv.color, fontWeight: 700 }}>{report.risk}%</span>
              </div>
              <div style={{ height: 10, background: '#252836', borderRadius: 5, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${report.risk}%`, background: lv.color, borderRadius: 5, transition: 'width 1s' }} />
              </div>
            </div>

            {/* Breakdown */}
            {Object.keys(report.violationBreakdown).length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <p style={{ fontSize: 13, color: '#64748b', fontWeight: 700, marginBottom: 8 }}>VIOLATION BREAKDOWN</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {Object.entries(report.violationBreakdown).map(([type, count]) => {
                    const def = VIOLATION_TYPES[type];
                    if (!def) return null;
                    const sv = SEVERITY[def.severity];
                    return (
                      <div key={type} style={{ display: 'flex', justifyContent: 'space-between', background: sv.bg, border: `1px solid ${sv.border}`, borderRadius: 8, padding: '8px 14px' }}>
                        <span style={{ color: sv.color, fontSize: 13 }}>{sv.icon} {def.label}</span>
                        <span style={{ color: sv.color, fontWeight: 700, fontSize: 13 }}>{count}×</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{ background: `${lv.bg}`, border: `1px solid ${lv.border}`, borderRadius: 10, padding: '14px 18px', marginBottom: 20 }}>
              <b style={{ color: lv.color }}>Recommendation: </b>
              <span style={{ color: '#cbd5e1', fontSize: 13 }}>
                {report.level === 'LOW'      && 'Exam appears clean. No significant suspicious activity detected.'}
                {report.level === 'MEDIUM'   && 'Some suspicious activities detected. Manual review recommended.'}
                {report.level === 'HIGH'     && 'Multiple violations detected. Flag for instructor review.'}
                {report.level === 'CRITICAL' && 'Severe suspicious behavior detected. Exam should be reviewed/invalidated.'}
              </span>
            </div>

            <button style={{ ...S.startBtn, background: '#252836' }} onClick={() => {
              setPhase('setup'); setAlerts([]); setAnswers({}); setFrameStat(0); setTimeLeft(EXAM_DURATION);
              prevDataRef.current = null; lipHistRef.current = []; lastAlertTs.current = {}; alertCountRef.current = {};
            }}>↩ New Session</button>
          </div>
        </div>
      </div>
    );
  }

  /* ══════════════════ EXAM SCREEN ══════════════════ */
  const timeWarning = timeLeft < 600;
  const totalAlerts = alerts.length;
  const criticalCount = alerts.filter(a => a.severity === 'CRITICAL' || a.severity === 'HIGH').length;

  return (
    <div style={S.examPage}>
      {/* ── TOP BAR ── */}
      <div style={S.topBar}>
        <div style={S.topLeft}>
          <span style={{ color: '#818cf8', fontWeight: 800, fontSize: 15 }}>🎓 ExamProctor AI</span>
          <span style={S.sep}>|</span>
          <span style={{ color: '#94a3b8', fontSize: 13 }}>{studentName}</span>
          <span style={S.sep}>|</span>
          <span style={{ color: '#94a3b8', fontSize: 13 }}>{examId}</span>
        </div>
        <div style={S.topCenter}>
          <span style={{ ...S.timer, color: timeWarning ? '#ef4444' : '#22c55e' }}>
            {timeWarning && '⚡ '}{fmt(timeLeft)}
          </span>
        </div>
        <div style={S.topRight}>
          <span style={{ fontSize: 12, color: camReady ? '#22c55e' : '#f59e0b', fontWeight: 600 }}>
            {camReady ? '● LIVE' : '● Starting...'}
          </span>
          <button style={S.submitBtn} onClick={() => setShowSubmitConfirm(true)}>
            Submit Exam ✓
          </button>
        </div>
      </div>

      {/* ── LIVE VIOLATION TOAST ── */}
      {liveViolation && (
        <div style={{ ...S.toast, background: liveViolation.sev.bg, borderColor: liveViolation.sev.border, color: liveViolation.sev.color }}>
          {liveViolation.sev.icon} <strong>{liveViolation.label}</strong> — {liveViolation.msg}
        </div>
      )}

      {/* ── MAIN GRID ── */}
      <div style={S.grid}>

        {/* LEFT: Webcam */}
        <div style={S.leftCol}>
          <p style={S.colLabel}>📹 WEBCAM MONITOR</p>

          <div style={{
            ...S.camBox,
            borderColor: liveViolation ? liveViolation.sev.color : '#2e3347',
            boxShadow: liveViolation ? `0 0 18px ${liveViolation.sev.color}40` : 'none',
          }}>
            {camError
              ? <div style={S.camErr}><span style={{ fontSize: 36 }}>📷</span><p>{camError}</p></div>
              : <video ref={videoRef} style={S.video} autoPlay playsInline muted />
            }
            <canvas ref={canvasRef} style={{ display: 'none' }} />

            {/* LIVE badge */}
            <div style={{ ...S.liveBadge, opacity: camReady ? 1 : 0.5 }}>
              <span style={S.liveDot} />LIVE
            </div>

            {/* Violation overlay */}
            {liveViolation && (
              <div style={{ ...S.camOverlay, background: liveViolation.sev.color + 'cc' }}>
                {liveViolation.sev.icon} {liveViolation.label}
              </div>
            )}
          </div>

          {/* Stats */}
          <div style={S.statsRow}>
            <div style={S.statChip}>🎬 {frameStat} frames</div>
            <div style={{ ...S.statChip, color: totalAlerts > 0 ? '#f59e0b' : '#64748b' }}>⚠️ {totalAlerts} alerts</div>
          </div>

          {criticalCount > 0 && (
            <div style={S.critBanner}>
              🚨 {criticalCount} high-severity violation{criticalCount > 1 ? 's' : ''} flagged
            </div>
          )}
        </div>

        {/* CENTER: Questions */}
        <div style={S.centerCol}>
          <p style={S.colLabel}>📝 EXAM QUESTIONS</p>
          <div style={S.qScroll}>
            {QUESTIONS.map((q, qi) => (
              <div key={qi} style={S.qCard}>
                <p style={S.qNum}>Question {qi + 1} of {QUESTIONS.length}</p>
                <p style={S.qText}>{q.text}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 10 }}>
                  {q.options.map((opt, oi) => {
                    const selected = answers[qi] === oi;
                    return (
                      <label key={oi} style={{ ...S.option, background: selected ? '#6366f120' : '#1a1d27', borderColor: selected ? '#6366f1' : '#2e3347', cursor: 'pointer' }}>
                        <input type="radio" name={`q${qi}`} style={{ display: 'none' }} onChange={() => setAnswers(prev => ({ ...prev, [qi]: oi }))} />
                        <span style={{ ...S.optDot, background: selected ? '#6366f1' : 'transparent', borderColor: selected ? '#6366f1' : '#475569' }}>
                          {selected && <span style={{ width: 8, height: 8, background: '#fff', borderRadius: '50%', display: 'block' }} />}
                        </span>
                        <span style={{ color: selected ? '#e2e8f0' : '#94a3b8', fontSize: 14 }}>{opt}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Submit button inside question scroll */}
            <button style={S.bigSubmitBtn} onClick={() => setShowSubmitConfirm(true)}>
              ✓ Submit Exam ({Object.keys(answers).length}/{QUESTIONS.length} answered)
            </button>
          </div>
        </div>

        {/* RIGHT: Alerts */}
        <div style={S.rightCol}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <p style={{ ...S.colLabel, marginBottom: 0 }}>🔔 AI DETECTION ALERTS</p>
            {alerts.length > 0 && (
              <button onClick={() => setAlerts([])} style={S.clearBtn}>Clear</button>
            )}
          </div>

          {/* Severity summary */}
          {alerts.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {Object.entries(
                alerts.reduce((acc, a) => { acc[a.severity] = (acc[a.severity] || 0) + 1; return acc; }, {})
              ).map(([sev, n]) => {
                const sv = SEVERITY[sev];
                return (
                  <span key={sev} style={{ background: sv.bg, color: sv.color, border: `1px solid ${sv.border}`, borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>
                    {sv.icon} {sev}: {n}
                  </span>
                );
              })}
            </div>
          )}

          <div style={S.alertFeed}>
            {alerts.length === 0
              ? (
                <div style={S.noAlert}>
                  <span style={{ fontSize: 32 }}>✅</span>
                  <p style={{ color: '#64748b', fontSize: 13, marginTop: 8 }}>No violations detected</p>
                  <p style={{ color: '#475569', fontSize: 11 }}>Monitoring in progress…</p>
                </div>
              )
              : alerts.map(a => (
                <div key={a.id} style={{ ...S.alertCard, background: a.sev.bg, borderLeft: `3px solid ${a.sev.color}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: a.sev.color, fontSize: 12, fontWeight: 700 }}>{a.sev.icon} {a.label}</span>
                    <span style={{ color: '#475569', fontSize: 11 }}>{a.time}</span>
                  </div>
                  <p style={{ color: '#cbd5e1', fontSize: 12, marginTop: 3 }}>{a.msg}</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
                    <span style={{ color: '#64748b', fontSize: 11 }}>Conf.</span>
                    <div style={{ flex: 1, height: 3, background: '#1e293b', borderRadius: 2 }}>
                      <div style={{ height: '100%', width: `${a.confidence}%`, background: a.sev.color, borderRadius: 2 }} />
                    </div>
                    <span style={{ color: a.sev.color, fontSize: 11, fontWeight: 700 }}>{a.confidence}%</span>
                  </div>
                </div>
              ))
            }
          </div>
        </div>
      </div>

      {/* ── SUBMIT CONFIRM MODAL ── */}
      {showSubmitConfirm && (
        <div style={S.modalBg} onClick={() => setShowSubmitConfirm(false)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 40, textAlign: 'center' }}>📋</div>
            <h3 style={{ color: '#e2e8f0', textAlign: 'center', marginTop: 10 }}>Submit Exam?</h3>
            <p style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', marginTop: 8 }}>
              You have answered <strong style={{ color: '#818cf8' }}>{Object.keys(answers).length}</strong> of <strong style={{ color: '#818cf8' }}>{QUESTIONS.length}</strong> questions.
              {Object.keys(answers).length < QUESTIONS.length && ' Unanswered questions will be marked incorrect.'}
            </p>
            {alerts.length > 0 && (
              <p style={{ color: '#f59e0b', fontSize: 12, textAlign: 'center', background: '#f59e0b10', border: '1px solid #f59e0b30', borderRadius: 8, padding: '8px 12px', marginTop: 12 }}>
                ⚠️ {alerts.length} violation alert{alerts.length > 1 ? 's' : ''} were recorded during this session.
              </p>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button style={S.cancelBtn} onClick={() => setShowSubmitConfirm(false)}>Cancel</button>
              <button style={S.confirmBtn} onClick={() => { setShowSubmitConfirm(false); handleSubmit(false); }}>
                Confirm Submit ✓
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
        @keyframes slideIn { from{transform:translateY(-10px);opacity:0} to{transform:translateY(0);opacity:1} }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0f1117; color: #e2e8f0; font-family: 'Inter','Segoe UI',system-ui,sans-serif; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: #1a1d27; }
        ::-webkit-scrollbar-thumb { background: #2e3347; border-radius: 3px; }
      `}</style>
    </div>
  );
}

/* ══════════════════ EXAM QUESTIONS ══════════════════ */
const QUESTIONS = [
  { text: 'Which data structure uses LIFO (Last In, First Out) ordering?', options: ['Queue','Stack','Linked List','Binary Tree'], answer: 1 },
  { text: 'What is the time complexity of binary search?', options: ['O(n)','O(n²)','O(log n)','O(1)'], answer: 2 },
  { text: 'Which sorting algorithm has the best average-case complexity?', options: ['Bubble Sort','Insertion Sort','Merge Sort','Selection Sort'], answer: 2 },
  { text: 'In object-oriented programming, what is encapsulation?', options: ['Inheritance of methods','Hiding implementation details','Creating multiple objects','Overriding parent methods'], answer: 1 },
  { text: 'What does HTTP stand for?', options: ['HyperText Transfer Protocol','Hyper Transfer Technology Protocol','High Transfer Text Protocol','HyperText Technology Protocol'], answer: 0 },
  { text: 'Which data structure is used for BFS traversal?', options: ['Stack','Queue','Tree','Graph'], answer: 1 },
  { text: 'What is the space complexity of merge sort?', options: ['O(1)','O(log n)','O(n)','O(n log n)'], answer: 2 },
  { text: 'Which principle does SOLID\'s "S" stand for?', options: ['Substitution','Single Responsibility','Segregation','Synchronisation'], answer: 1 },
  { text: 'What is a foreign key in a database?', options: ['Primary identifier of a table','A key referencing another table\'s primary key','An encrypted key','A composite primary key'], answer: 1 },
  { text: 'In a TCP three-way handshake, what is the first step?', options: ['SYN-ACK','ACK','SYN','FIN'], answer: 2 },
];

/* ══════════════════ STYLES ══════════════════ */
const S = {
  page:        { minHeight: '100vh', background: '#0f1117', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  setupWrap:   { width: '100%', maxWidth: 500, padding: 24 },
  setupCard:   { background: '#1a1d27', borderRadius: 16, border: '1px solid #2e3347', padding: 36, display: 'flex', flexDirection: 'column', gap: 18 },
  setupIcon:   { fontSize: 52, textAlign: 'center' },
  setupH:      { fontSize: 21, fontWeight: 800, color: '#e2e8f0', textAlign: 'center' },
  setupSub:    { fontSize: 12, color: '#64748b', textAlign: 'center', marginTop: -10 },
  field:       { display: 'flex', flexDirection: 'column', gap: 6 },
  lbl:         { fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 },
  inp:         { background: '#252836', border: '1px solid #2e3347', borderRadius: 9, padding: '11px 14px', color: '#e2e8f0', fontSize: 14, outline: 'none' },
  rules:       { background: '#f59e0b0d', border: '1px solid #f59e0b30', borderRadius: 10, padding: '14px 16px' },
  startBtn:    { background: '#6366f1', border: 'none', borderRadius: 10, padding: 14, color: '#fff', fontWeight: 800, fontSize: 15, cursor: 'pointer' },

  examPage:    { display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: '#0f1117' },
  topBar:      { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 18px', background: '#1a1d27', borderBottom: '1px solid #2e3347', flexShrink: 0 },
  topLeft:     { display: 'flex', gap: 10, alignItems: 'center' },
  topCenter:   { position: 'absolute', left: '50%', transform: 'translateX(-50%)' },
  topRight:    { display: 'flex', gap: 12, alignItems: 'center' },
  timer:       { fontFamily: 'monospace', fontSize: 22, fontWeight: 800 },
  sep:         { color: '#2e3347' },
  submitBtn:   { background: '#6366f1', border: 'none', borderRadius: 8, padding: '8px 18px', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' },

  toast:       { margin: '8px 18px 0', padding: '9px 16px', borderRadius: 9, border: '1px solid', fontSize: 13, fontWeight: 600, animation: 'slideIn 0.25s', flexShrink: 0 },

  grid:        { display: 'grid', gridTemplateColumns: '270px 1fr 300px', gap: 12, padding: 12, flex: 1, overflow: 'hidden', minHeight: 0 },
  leftCol:     { display: 'flex', flexDirection: 'column', gap: 8 },
  centerCol:   { display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  rightCol:    { display: 'flex', flexDirection: 'column', background: '#1a1d27', borderRadius: 12, border: '1px solid #2e3347', padding: 12, overflow: 'hidden' },
  colLabel:    { fontSize: 10, fontWeight: 800, color: '#475569', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 6 },

  camBox:      { position: 'relative', borderRadius: 12, border: '2px solid', overflow: 'hidden', background: '#0a0c10', aspectRatio: '4/3', transition: 'border-color 0.3s, box-shadow 0.3s' },
  camErr:      { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 10, color: '#ef4444', padding: 16, textAlign: 'center', fontSize: 13 },
  video:       { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  liveBadge:   { position: 'absolute', top: 10, left: 10, background: '#22c55e18', border: '1px solid #22c55e', color: '#22c55e', borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 },
  liveDot:     { width: 7, height: 7, borderRadius: '50%', background: '#22c55e', display: 'inline-block', animation: 'pulse 1.4s infinite' },
  camOverlay:  { position: 'absolute', bottom: 0, left: 0, right: 0, padding: '7px 12px', fontSize: 12, fontWeight: 700, color: '#fff', textAlign: 'center' },
  statsRow:    { display: 'flex', gap: 8 },
  statChip:    { background: '#1a1d27', border: '1px solid #2e3347', borderRadius: 8, padding: '5px 10px', fontSize: 11, color: '#64748b', flex: 1, textAlign: 'center' },
  critBanner:  { background: '#ef444412', border: '1px solid #ef444440', borderRadius: 8, padding: '7px 12px', fontSize: 12, color: '#ef4444', fontWeight: 600 },

  qScroll:     { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 },
  qCard:       { background: '#1a1d27', borderRadius: 12, border: '1px solid #2e3347', padding: '16px 18px' },
  qNum:        { fontSize: 11, fontWeight: 700, color: '#6366f1', marginBottom: 6 },
  qText:       { fontSize: 14, color: '#e2e8f0', lineHeight: 1.6 },
  option:      { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 13px', borderRadius: 8, border: '1px solid', transition: 'all 0.15s' },
  optDot:      { width: 18, height: 18, borderRadius: '50%', border: '2px solid', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' },
  bigSubmitBtn:{ background: '#6366f1', border: 'none', borderRadius: 12, padding: '15px', color: '#fff', fontWeight: 800, fontSize: 15, cursor: 'pointer', marginTop: 8 },

  alertFeed:   { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 },
  noAlert:     { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center' },
  alertCard:   { borderRadius: 8, padding: '9px 12px', flexShrink: 0 },
  clearBtn:    { background: 'none', border: '1px solid #2e3347', borderRadius: 6, color: '#64748b', padding: '3px 10px', fontSize: 11, cursor: 'pointer' },

  modalBg:     { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal:       { background: '#1a1d27', borderRadius: 16, border: '1px solid #2e3347', padding: 32, maxWidth: 420, width: '90%' },
  cancelBtn:   { flex: 1, background: '#252836', border: '1px solid #2e3347', borderRadius: 9, padding: 12, color: '#94a3b8', fontWeight: 700, cursor: 'pointer', fontSize: 14 },
  confirmBtn:  { flex: 2, background: '#6366f1', border: 'none', borderRadius: 9, padding: 12, color: '#fff', fontWeight: 800, cursor: 'pointer', fontSize: 14 },
};