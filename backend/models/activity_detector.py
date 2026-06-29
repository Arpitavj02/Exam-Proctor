"""
Activity Detector
Combines CNN models, MTCNN face detection, MediaPipe pose/gaze,
and lip movement detection to flag suspicious exam behavior.
"""

import cv2
import numpy as np
import mediapipe as mp
from mtcnn import MTCNN


# ─── Thresholds ───────────────────────────────
GAZE_YAW_THRESHOLD    = 25   # degrees left/right
GAZE_PITCH_THRESHOLD  = 20   # degrees up/down
LIP_MOVEMENT_THRESH   = 3.0  # pixel distance change
MAX_FACES_ALLOWED     = 1
MIN_FACE_CONFIDENCE   = 0.90


class ActivityDetector:
    """
    Orchestrates all detection sub-systems:
      1. Face count (MTCNN)
      2. Head pose / gaze direction (MediaPipe FaceMesh)
      3. Lip movement / talking (MediaPipe FaceMesh landmarks)
      4. Object detection (CNN ensemble)
      5. No face / face absent
    """

    def __init__(self, model_manager):
        self.model_manager = model_manager

        # MTCNN for face detection
        print("  • Loading MTCNN face detector...")
        self.face_detector = MTCNN()

        # MediaPipe FaceMesh for pose & gaze
        print("  • Loading MediaPipe FaceMesh...")
        self.mp_face_mesh = mp.solutions.face_mesh
        self.face_mesh = self.mp_face_mesh.FaceMesh(
            static_image_mode=False,
            max_num_faces=4,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )

        # Lip tracking state
        self._prev_lip_dist = None
        self._lip_movement_buffer = []

        # Camera matrix for head pose estimation
        self._camera_matrix = None

    # ─── Public API ───────────────────────────

    def analyze_frame(self, frame):
        """
        Full analysis pipeline for one video frame.
        Returns dict with violations and metadata.
        """
        if frame is None or frame.size == 0:
            return {'violations': [], 'face_count': 0, 'confidence_scores': {}}

        h, w = frame.shape[:2]
        violations = []
        confidence_scores = {}

        # 1. Face detection via MTCNN
        faces = self._detect_faces(frame)
        face_count = len(faces)
        confidence_scores['face_detection'] = max((f['confidence'] for f in faces), default=0)

        if face_count == 0:
            violations.append({
                'type': 'NO_FACE',
                'severity': 'HIGH',
                'message': 'No face detected in frame',
                'confidence': 0.95
            })
        elif face_count > MAX_FACES_ALLOWED:
            violations.append({
                'type': 'MULTIPLE_FACES',
                'severity': 'CRITICAL',
                'message': f'{face_count} faces detected in frame',
                'confidence': 0.92,
                'details': {'count': face_count}
            })

        # 2. Gaze & head pose via MediaPipe
        if face_count >= 1:
            pose_result = self._estimate_head_pose(frame, w, h)
            if pose_result:
                confidence_scores['head_pose'] = pose_result.get('confidence', 0)
                
                if pose_result.get('looking_away'):
                    violations.append({
                        'type': 'LOOKING_AWAY',
                        'severity': 'MEDIUM',
                        'message': f"Looking away — yaw: {pose_result['yaw']:.1f}°, pitch: {pose_result['pitch']:.1f}°",
                        'confidence': pose_result.get('confidence', 0.80),
                        'details': pose_result
                    })

            # 3. Lip movement
            lip_result = self._detect_lip_movement(frame)
            if lip_result and lip_result.get('talking'):
                violations.append({
                    'type': 'LIP_MOVEMENT',
                    'severity': 'MEDIUM',
                    'message': 'Lip movement / talking detected',
                    'confidence': lip_result.get('confidence', 0.75),
                    'details': {'movement_score': lip_result.get('score', 0)}
                })

        # 4. Object detection via CNN
        if self.model_manager.is_ready():
            suspicious_objects = self.model_manager.detect_suspicious_objects(frame)
            for obj in suspicious_objects:
                violations.append({
                    'type': 'SUSPICIOUS_OBJECT',
                    'severity': 'HIGH',
                    'message': f"Suspicious object detected: {obj['object']}",
                    'confidence': obj['confidence'],
                    'details': obj
                })

        return {
            'violations': violations,
            'face_count': face_count,
            'confidence_scores': confidence_scores,
            'faces': [
                {'bbox': f['box'], 'confidence': f['confidence']}
                for f in faces
            ]
        }

    # ─── Sub-detectors ────────────────────────

    def _detect_faces(self, frame):
        """Detect faces with MTCNN"""
        try:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = self.face_detector.detect_faces(rgb)
            return [r for r in results if r['confidence'] >= MIN_FACE_CONFIDENCE]
        except Exception as e:
            print(f"Face detection error: {e}")
            return []

    def _estimate_head_pose(self, frame, w, h):
        """
        Estimate head yaw & pitch using MediaPipe FaceMesh landmarks.
        Returns dict with yaw, pitch, looking_away flag.
        """
        try:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = self.face_mesh.process(rgb)

            if not results.multi_face_landmarks:
                return None

            landmarks = results.multi_face_landmarks[0].landmark

            # Key landmark indices
            # Nose tip: 1, Chin: 152, Left eye left: 33, Right eye right: 263
            # Left mouth: 61, Right mouth: 291
            nose_tip   = np.array([landmarks[1].x * w,   landmarks[1].y * h,   landmarks[1].z * w])
            chin       = np.array([landmarks[152].x * w, landmarks[152].y * h, landmarks[152].z * w])
            left_eye   = np.array([landmarks[33].x * w,  landmarks[33].y * h,  landmarks[33].z * w])
            right_eye  = np.array([landmarks[263].x * w, landmarks[263].y * h, landmarks[263].z * w])
            left_mouth = np.array([landmarks[61].x * w,  landmarks[61].y * h,  landmarks[61].z * w])
            right_mouth= np.array([landmarks[291].x * w, landmarks[291].y * h, landmarks[291].z * w])

            # Compute yaw (horizontal turn): use nose vs midpoint of eyes
            eye_mid = (left_eye + right_eye) / 2
            face_vec = nose_tip - eye_mid

            # Simplified yaw from x displacement relative to face width
            face_width = np.linalg.norm(right_eye - left_eye) + 1e-6
            yaw = (face_vec[0] / face_width) * 90   # scale to degrees

            # Simplified pitch from y displacement relative to face height
            face_height = np.linalg.norm(chin - eye_mid) + 1e-6
            pitch = (face_vec[1] / face_height) * 90

            looking_away = (abs(yaw) > GAZE_YAW_THRESHOLD or
                           abs(pitch) > GAZE_PITCH_THRESHOLD)

            confidence = min(0.95, 0.6 + 0.01 * (abs(yaw) + abs(pitch)))

            return {
                'yaw': float(yaw),
                'pitch': float(pitch),
                'looking_away': looking_away,
                'confidence': float(confidence)
            }

        except Exception as e:
            print(f"Head pose error: {e}")
            return None

    def _detect_lip_movement(self, frame):
        """
        Detect lip movement by tracking mouth landmark distances
        between consecutive frames.
        """
        try:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = self.face_mesh.process(rgb)

            if not results.multi_face_landmarks:
                return None

            lm = results.multi_face_landmarks[0].landmark
            h, w = frame.shape[:2]

            # Upper lip center: 13, Lower lip center: 14
            upper_lip = np.array([lm[13].x * w, lm[13].y * h])
            lower_lip = np.array([lm[14].x * w, lm[14].y * h])
            lip_dist  = np.linalg.norm(upper_lip - lower_lip)

            # Track movement over buffer
            self._lip_movement_buffer.append(lip_dist)
            if len(self._lip_movement_buffer) > 10:
                self._lip_movement_buffer.pop(0)

            if len(self._lip_movement_buffer) < 3:
                return None

            movement_score = np.std(self._lip_movement_buffer)
            talking = movement_score > LIP_MOVEMENT_THRESH

            return {
                'talking': talking,
                'score': float(movement_score),
                'confidence': min(0.90, 0.5 + movement_score * 0.05)
            }

        except Exception as e:
            print(f"Lip movement error: {e}")
            return None
