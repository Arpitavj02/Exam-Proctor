"""
AI-Powered Online Exam Proctoring System
Main Flask Application with WebSocket support
"""

import os
import base64
import json
import time
import uuid
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room
import cv2
import numpy as np
from dotenv import load_dotenv

# Local imports
from models.cnn_model import CNNModelManager
from models.activity_detector import ActivityDetector
from utils.alert_utils import AlertManager
from routes.exam import exam_bp
from routes.detection import detection_bp

load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'exam-proctor-secret-2024')
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max upload

CORS(app, resources={r"/api/*": {"origins": "*"}})
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

# Register Blueprints
app.register_blueprint(exam_bp, url_prefix='/api/exam')
app.register_blueprint(detection_bp, url_prefix='/api/detect')

# Initialize models (loaded once at startup)
print("🧠 Loading CNN Models...")
model_manager = CNNModelManager()
model_manager.load_all_models()

# Initialize detector
detector = ActivityDetector(model_manager)
alert_manager = AlertManager()

# In-memory session store (use Redis in production)
active_sessions = {}

# ─────────────────────────────────────────────
#  REST ENDPOINTS
# ─────────────────────────────────────────────

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'running',
        'models_loaded': model_manager.is_ready(),
        'timestamp': datetime.now().isoformat(),
        'active_sessions': len(active_sessions)
    })


@app.route('/api/session/start', methods=['POST'])
def start_session():
    """Start a new proctoring session"""
    data = request.json or {}
    session_id = str(uuid.uuid4())
    
    active_sessions[session_id] = {
        'id': session_id,
        'student_name': data.get('student_name', 'Unknown'),
        'exam_id': data.get('exam_id', 'EXAM001'),
        'start_time': datetime.now().isoformat(),
        'alerts': [],
        'frame_count': 0,
        'violation_count': 0
    }
    
    print(f"✅ Session started: {session_id}")
    return jsonify({'session_id': session_id, 'status': 'started'})


@app.route('/api/session/<session_id>/end', methods=['POST'])
def end_session(session_id):
    """End a proctoring session and return report"""
    if session_id not in active_sessions:
        return jsonify({'error': 'Session not found'}), 404
    
    session = active_sessions[session_id]
    session['end_time'] = datetime.now().isoformat()
    
    report = generate_report(session)
    del active_sessions[session_id]
    
    return jsonify(report)


@app.route('/api/session/<session_id>/report', methods=['GET'])
def get_session_report(session_id):
    """Get current session report"""
    if session_id not in active_sessions:
        return jsonify({'error': 'Session not found'}), 404
    return jsonify(active_sessions[session_id])


@app.route('/api/analyze/frame', methods=['POST'])
def analyze_frame():
    """Analyze a single frame for suspicious activity"""
    data = request.json
    if not data or 'image' not in data:
        return jsonify({'error': 'No image provided'}), 400
    
    session_id = data.get('session_id')
    image_data = data['image']
    
    # Decode base64 image
    try:
        if ',' in image_data:
            image_data = image_data.split(',')[1]
        img_bytes = base64.b64decode(image_data)
        img_array = np.frombuffer(img_bytes, dtype=np.uint8)
        frame = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
        
        if frame is None:
            return jsonify({'error': 'Invalid image'}), 400
            
    except Exception as e:
        return jsonify({'error': f'Image decode error: {str(e)}'}), 400
    
    # Run detection
    results = detector.analyze_frame(frame)
    
    # Update session
    if session_id and session_id in active_sessions:
        session = active_sessions[session_id]
        session['frame_count'] += 1
        
        if results['violations']:
            session['violation_count'] += len(results['violations'])
            for violation in results['violations']:
                alert = alert_manager.create_alert(violation, session_id)
                session['alerts'].append(alert)
                # Broadcast alert via WebSocket
                socketio.emit('new_alert', alert, room=f'admin_{session_id}')
    
    return jsonify(results)


# ─────────────────────────────────────────────
#  WEBSOCKET EVENTS
# ─────────────────────────────────────────────

@socketio.on('connect')
def handle_connect():
    print(f"🔌 Client connected: {request.sid}")
    emit('connected', {'status': 'ok', 'sid': request.sid})


@socketio.on('disconnect')
def handle_disconnect():
    print(f"❌ Client disconnected: {request.sid}")


@socketio.on('join_session')
def handle_join_session(data):
    """Student joins a proctoring session"""
    session_id = data.get('session_id')
    role = data.get('role', 'student')
    
    room = f'admin_{session_id}' if role == 'admin' else f'student_{session_id}'
    join_room(room)
    emit('joined', {'room': room, 'session_id': session_id})
    print(f"👤 {role} joined session: {session_id}")


@socketio.on('leave_session')
def handle_leave_session(data):
    session_id = data.get('session_id')
    leave_room(f'student_{session_id}')
    leave_room(f'admin_{session_id}')


@socketio.on('stream_frame')
def handle_stream_frame(data):
    """Process streaming frame from student webcam"""
    session_id = data.get('session_id')
    image_data = data.get('image')
    
    if not image_data:
        return
    
    try:
        if ',' in image_data:
            image_data = image_data.split(',')[1]
        img_bytes = base64.b64decode(image_data)
        img_array = np.frombuffer(img_bytes, dtype=np.uint8)
        frame = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
        
        if frame is None:
            return
        
        results = detector.analyze_frame(frame)
        
        if session_id and session_id in active_sessions:
            session = active_sessions[session_id]
            session['frame_count'] += 1
            
            if results['violations']:
                session['violation_count'] += len(results['violations'])
                for violation in results['violations']:
                    alert = alert_manager.create_alert(violation, session_id)
                    session['alerts'].append(alert)
                    socketio.emit('new_alert', alert, room=f'admin_{session_id}')
        
        # Send results back to student
        emit('frame_result', {
            'violations': results['violations'],
            'face_count': results.get('face_count', 0),
            'confidence_scores': results.get('confidence_scores', {}),
            'timestamp': time.time()
        })
        
    except Exception as e:
        print(f"Frame processing error: {e}")


@socketio.on('get_sessions')
def handle_get_sessions():
    """Admin requests list of active sessions"""
    sessions_list = [
        {
            'id': s['id'],
            'student_name': s['student_name'],
            'exam_id': s['exam_id'],
            'start_time': s['start_time'],
            'violation_count': s['violation_count'],
            'frame_count': s['frame_count']
        }
        for s in active_sessions.values()
    ]
    emit('sessions_list', {'sessions': sessions_list})


# ─────────────────────────────────────────────
#  HELPERS
# ─────────────────────────────────────────────

def generate_report(session):
    """Generate exam session report"""
    alerts = session.get('alerts', [])
    
    violation_counts = {}
    for alert in alerts:
        v_type = alert.get('type', 'unknown')
        violation_counts[v_type] = violation_counts.get(v_type, 0) + 1
    
    total_frames = session.get('frame_count', 1)
    violation_rate = (session.get('violation_count', 0) / total_frames) * 100
    
    risk_score = min(100, violation_rate * 10)
    if risk_score < 20:
        risk_level = 'LOW'
    elif risk_score < 50:
        risk_level = 'MEDIUM'
    elif risk_score < 80:
        risk_level = 'HIGH'
    else:
        risk_level = 'CRITICAL'
    
    return {
        'session_id': session['id'],
        'student_name': session['student_name'],
        'exam_id': session['exam_id'],
        'start_time': session['start_time'],
        'end_time': session.get('end_time'),
        'total_frames_analyzed': total_frames,
        'total_violations': session.get('violation_count', 0),
        'violation_rate_percent': round(violation_rate, 2),
        'risk_score': round(risk_score, 1),
        'risk_level': risk_level,
        'violation_breakdown': violation_counts,
        'alerts': alerts[-20:],  # Last 20 alerts
        'recommendation': get_recommendation(risk_level)
    }


def get_recommendation(risk_level):
    recommendations = {
        'LOW': 'Exam appears clean. Normal activity detected.',
        'MEDIUM': 'Some suspicious activities detected. Manual review recommended.',
        'HIGH': 'Multiple violations detected. Flag for instructor review.',
        'CRITICAL': 'Severe cheating behavior detected. Exam should be invalidated.'
    }
    return recommendations.get(risk_level, 'Unknown')


if __name__ == '__main__':
    print("🚀 Starting Exam Proctoring Server...")
    print("📡 API: http://localhost:5000")
    print("🔌 WebSocket: ws://localhost:5000")
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
