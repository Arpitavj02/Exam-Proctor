import { useEffect, useRef, useCallback, useState } from 'react';
import { io } from 'socket.io-client';

const BACKEND_URL = 'http://localhost:5000';

export function useWebSocket(sessionId, role = 'student') {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [frameResult, setFrameResult] = useState(null);

  useEffect(() => {
    const socket = io(BACKEND_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      if (sessionId) {
        socket.emit('join_session', { session_id: sessionId, role });
      }
    });

    socket.on('disconnect', () => setConnected(false));

    socket.on('new_alert', (alert) => {
      setAlerts(prev => [alert, ...prev].slice(0, 50));
    });

    socket.on('frame_result', (result) => {
      setFrameResult(result);
      if (result.violations?.length > 0) {
        result.violations.forEach(v => {
          setAlerts(prev => [{
            id: Date.now() + Math.random(),
            ...v,
            timestamp: new Date().toISOString()
          }, ...prev].slice(0, 50));
        });
      }
    });

    return () => socket.disconnect();
  }, [sessionId, role]);

  const sendFrame = useCallback((imageData) => {
    if (socketRef.current?.connected && sessionId) {
      socketRef.current.emit('stream_frame', {
        session_id: sessionId,
        image: imageData
      });
    }
  }, [sessionId]);

  const clearAlerts = useCallback(() => setAlerts([]), []);

  return { connected, alerts, frameResult, sendFrame, clearAlerts, socket: socketRef.current };
}
