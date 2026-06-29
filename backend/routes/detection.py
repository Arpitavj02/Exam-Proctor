"""Detection API routes"""
from flask import Blueprint, jsonify, request

detection_bp = Blueprint('detection', __name__)

@detection_bp.route('/status', methods=['GET'])
def detection_status():
    return jsonify({
        'models': ['MobileNetV2', 'ResNet50', 'EfficientNet-B0'],
        'detectors': ['MTCNN', 'MediaPipe FaceMesh', 'CNN Ensemble'],
        'status': 'active'
    })
