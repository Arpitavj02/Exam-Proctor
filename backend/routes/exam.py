"""Exam management routes"""
from flask import Blueprint, jsonify, request
from datetime import datetime

exam_bp = Blueprint('exam', __name__)

MOCK_EXAMS = {
    'EXAM001': {'title': 'Data Structures & Algorithms', 'duration': 90, 'total_marks': 100},
    'EXAM002': {'title': 'Machine Learning Fundamentals', 'duration': 120, 'total_marks': 100},
    'EXAM003': {'title': 'Computer Networks', 'duration': 60, 'total_marks': 50},
}

@exam_bp.route('/list', methods=['GET'])
def list_exams():
    return jsonify({'exams': MOCK_EXAMS})

@exam_bp.route('/<exam_id>', methods=['GET'])
def get_exam(exam_id):
    exam = MOCK_EXAMS.get(exam_id)
    if not exam:
        return jsonify({'error': 'Exam not found'}), 404
    return jsonify({'exam_id': exam_id, **exam})
