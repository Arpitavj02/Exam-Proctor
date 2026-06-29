import React, { useRef, useEffect, useState, useCallback } from 'react';

const CAPTURE_INTERVAL_MS = 1000; // Capture every 1 second

export default function VideoFeed({ onFrame, active = true, violations = [] }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const intervalRef = useRef(null);
  const streamRef = useRef(null);

  const [cameraError, setCameraError] = useState(null);
  const [cameraActive, setCameraActive] = useState(false);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setCameraActive(true);
        setCameraError(null);
      }
    } catch (err) {
      setCameraError('Camera access denied. Please allow camera permissions.');
      console.error('Camera error:', err);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (intervalRef.current) clearInterval(intervalRef.current);
    setCameraActive(false);
  }, []);

  const captureFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !cameraActive) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    if (onFrame) onFrame(dataUrl);
  }, [cameraActive, onFrame]);

  useEffect(() => {
    if (active) {
      startCamera();
    } else {
      stopCamera();
    }
    return stopCamera;
  }, [active]);

  useEffect(() => {
    if (cameraActive && active) {
      intervalRef.current = setInterval(captureFrame, CAPTURE_INTERVAL_MS);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [cameraActive, active, captureFrame]);

  const hasViolation = violations.length > 0;
  const severity = violations[0]?.severity;
  const borderColor = severity === 'CRITICAL' ? '#7c3aed' : severity === 'HIGH' ? '#ef4444' : severity === 'MEDIUM' ? '#f59e0b' : '#22c55e';

  return (
    <div style={styles.wrapper}>
      <div style={{
        ...styles.videoBox,
        borderColor: hasViolation ? borderColor : '#2e3347',
        boxShadow: hasViolation ? `0 0 20px ${borderColor}40` : 'none'
      }}>
        {cameraError ? (
          <div style={styles.error}>
            <span style={{ fontSize: 40 }}>📷</span>
            <p>{cameraError}</p>
          </div>
        ) : (
          <video
            ref={videoRef}
            style={styles.video}
            autoPlay
            playsInline
            muted
          />
        )}

        {/* Status badge */}
        <div style={{
          ...styles.badge,
          background: cameraActive ? '#22c55e22' : '#ef444422',
          borderColor: cameraActive ? '#22c55e' : '#ef4444',
          color: cameraActive ? '#22c55e' : '#ef4444'
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'currentColor', display: 'inline-block', marginRight: 6, animation: cameraActive ? 'pulse 1.5s infinite' : 'none' }} />
          {cameraActive ? 'LIVE' : 'OFF'}
        </div>

        {/* Violation overlay */}
        {hasViolation && (
          <div style={{ ...styles.violationBanner, background: borderColor + 'cc' }}>
            ⚠️ {violations[0]?.message || 'Suspicious activity detected'}
          </div>
        )}
      </div>

      <canvas ref={canvasRef} style={{ display: 'none' }} />

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>
    </div>
  );
}

const styles = {
  wrapper: { display: 'flex', flexDirection: 'column', gap: 8 },
  videoBox: {
    position: 'relative',
    borderRadius: 12,
    border: '2px solid',
    overflow: 'hidden',
    background: '#0a0c10',
    aspectRatio: '4/3',
    transition: 'border-color 0.3s, box-shadow 0.3s'
  },
  video: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  error: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', height: '100%', gap: 12,
    color: '#ef4444', padding: 20, textAlign: 'center', fontSize: 14
  },
  badge: {
    position: 'absolute', top: 12, left: 12,
    padding: '4px 12px', borderRadius: 20, border: '1px solid',
    fontSize: 11, fontWeight: 700, letterSpacing: 1,
    display: 'flex', alignItems: 'center'
  },
  violationBanner: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: '8px 16px', fontSize: 13, fontWeight: 600,
    color: '#fff', textAlign: 'center'
  }
};
