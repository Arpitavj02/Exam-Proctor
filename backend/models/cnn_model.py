"""
CNN Model Manager
Loads and manages pre-trained models: MobileNetV2, ResNet50, EfficientNet-B0
"""

import os
import numpy as np
import torch
import torch.nn as nn
import torchvision.models as models
import torchvision.transforms as transforms
from PIL import Image
import cv2


# ─── ImageNet class labels for object detection ───
IMAGENET_LABELS_URL = "https://raw.githubusercontent.com/pytorch/hub/master/imagenet_classes.txt"

# Suspicious objects to flag
SUSPICIOUS_OBJECTS = [
    'cell phone', 'mobile phone', 'book', 'notebook', 'laptop',
    'remote control', 'calculator', 'tablet', 'headphones', 'earphone',
    'person'   # additional person in frame
]


class CNNModelManager:
    """Manages multiple pre-trained CNN models for activity detection"""

    def __init__(self):
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        print(f"🖥️  Running on: {self.device}")
        
        self.models = {}
        self.transforms = self._build_transforms()
        self.ready = False
        self.imagenet_classes = []

    def _build_transforms(self):
        """Standard ImageNet preprocessing"""
        return transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize(
                mean=[0.485, 0.456, 0.406],
                std=[0.229, 0.224, 0.225]
            )
        ])

    def load_all_models(self):
        """Load all three CNN models"""
        print("📦 Loading MobileNetV2...")
        self.models['mobilenet'] = self._load_mobilenet()
        
        print("📦 Loading ResNet50...")
        self.models['resnet'] = self._load_resnet()
        
        print("📦 Loading EfficientNet-B0...")
        self.models['efficientnet'] = self._load_efficientnet()
        
        # Load ImageNet class labels
        self._load_imagenet_labels()
        
        self.ready = True
        print("✅ All models loaded successfully!")

    def _load_mobilenet(self):
        """Load pretrained MobileNetV2"""
        model = models.mobilenet_v2(weights=models.MobileNet_V2_Weights.IMAGENET1K_V1)
        model.eval()
        model.to(self.device)
        return model

    def _load_resnet(self):
        """Load pretrained ResNet50"""
        model = models.resnet50(weights=models.ResNet50_Weights.IMAGENET1K_V1)
        model.eval()
        model.to(self.device)
        return model

    def _load_efficientnet(self):
        """Load pretrained EfficientNet-B0"""
        model = models.efficientnet_b0(weights=models.EfficientNet_B0_Weights.IMAGENET1K_V1)
        model.eval()
        model.to(self.device)
        return model

    def _load_imagenet_labels(self):
        """Load ImageNet class names"""
        try:
            import urllib.request
            with urllib.request.urlopen(IMAGENET_LABELS_URL, timeout=5) as f:
                self.imagenet_classes = [line.strip() for line in f.readlines()]
        except Exception:
            # Fallback: basic labels
            self.imagenet_classes = [f'class_{i}' for i in range(1000)]
            # Inject key labels at known positions
            self.imagenet_classes[487] = 'cell phone'
            self.imagenet_classes[654] = 'laptop'
            self.imagenet_classes[631] = 'book'

    def preprocess_frame(self, frame):
        """Convert OpenCV BGR frame to model-ready tensor"""
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(rgb)
        tensor = self.transforms(pil_img).unsqueeze(0)
        return tensor.to(self.device)

    def predict_single(self, model_name, tensor):
        """Run inference with one model, return top-5 predictions"""
        model = self.models.get(model_name)
        if model is None:
            return []
        
        with torch.no_grad():
            outputs = model(tensor)
            probabilities = torch.nn.functional.softmax(outputs[0], dim=0)
            top5_prob, top5_idx = torch.topk(probabilities, 5)
        
        results = []
        for prob, idx in zip(top5_prob.cpu().numpy(), top5_idx.cpu().numpy()):
            label = self.imagenet_classes[idx] if idx < len(self.imagenet_classes) else f'class_{idx}'
            results.append({
                'label': label,
                'confidence': float(prob),
                'class_id': int(idx)
            })
        return results

    def predict_ensemble(self, tensor):
        """Ensemble prediction: average probabilities across all models"""
        all_probs = []
        
        for model_name, model in self.models.items():
            with torch.no_grad():
                outputs = model(tensor)
                probs = torch.nn.functional.softmax(outputs[0], dim=0)
                all_probs.append(probs)
        
        # Average probabilities
        ensemble_probs = torch.stack(all_probs).mean(dim=0)
        top5_prob, top5_idx = torch.topk(ensemble_probs, 5)
        
        results = []
        for prob, idx in zip(top5_prob.cpu().numpy(), top5_idx.cpu().numpy()):
            label = self.imagenet_classes[idx] if idx < len(self.imagenet_classes) else f'class_{idx}'
            results.append({
                'label': label,
                'confidence': float(prob),
                'class_id': int(idx)
            })
        return results

    def detect_suspicious_objects(self, frame, threshold=0.15):
        """
        Detect if any suspicious objects (phone, book, etc.) are in the frame.
        Uses ensemble for best accuracy.
        Returns list of detected suspicious objects.
        """
        tensor = self.preprocess_frame(frame)
        predictions = self.predict_ensemble(tensor)
        
        detected = []
        for pred in predictions:
            label_lower = pred['label'].lower()
            for suspicious in SUSPICIOUS_OBJECTS:
                if suspicious in label_lower and pred['confidence'] > threshold:
                    detected.append({
                        'object': suspicious,
                        'confidence': pred['confidence'],
                        'label': pred['label']
                    })
        return detected

    def get_model_predictions(self, frame):
        """Get predictions from each model individually (for comparison)"""
        tensor = self.preprocess_frame(frame)
        
        return {
            'mobilenet': self.predict_single('mobilenet', tensor),
            'resnet': self.predict_single('resnet', tensor),
            'efficientnet': self.predict_single('efficientnet', tensor),
            'ensemble': self.predict_ensemble(tensor)
        }

    def is_ready(self):
        return self.ready
