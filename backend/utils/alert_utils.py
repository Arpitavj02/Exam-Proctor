"""Alert Manager - generates structured alerts from violations"""

import uuid
from datetime import datetime


SEVERITY_COLORS = {
    'LOW': '#22c55e',
    'MEDIUM': '#f59e0b',
    'HIGH': '#ef4444',
    'CRITICAL': '#7c3aed'
}

SEVERITY_SCORES = {
    'LOW': 1,
    'MEDIUM': 3,
    'HIGH': 7,
    'CRITICAL': 10
}


class AlertManager:
    def create_alert(self, violation, session_id):
        severity = violation.get('severity', 'MEDIUM')
        return {
            'id': str(uuid.uuid4()),
            'session_id': session_id,
            'type': violation.get('type', 'UNKNOWN'),
            'severity': severity,
            'message': violation.get('message', 'Suspicious activity detected'),
            'confidence': round(violation.get('confidence', 0.0) * 100, 1),
            'score': SEVERITY_SCORES.get(severity, 3),
            'color': SEVERITY_COLORS.get(severity, '#f59e0b'),
            'timestamp': datetime.now().isoformat(),
            'details': violation.get('details', {})
        }
