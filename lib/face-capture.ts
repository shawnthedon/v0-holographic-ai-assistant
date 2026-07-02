'use client';

import {
  FaceLandmarker,
  FilesetResolver,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision';

export interface FaceMesh {
  landmarks: NormalizedLandmark[];
  blendshapes: Record<string, number>;
  confidence: number;
}

export interface FaceCaptureConfig {
  meshPointCount?: number;
  confidenceThreshold?: number;
  fpsTarget?: number;
}

const DEFAULT_CONFIG: Required<FaceCaptureConfig> = {
  meshPointCount: 468,
  confidenceThreshold: 0.5,
  fpsTarget: 30,
};

let faceLandmarker: FaceLandmarker | null = null;
let isInitializing = false;

/**
 * Lazy-load MediaPipe FaceLandmarker on first use
 */
export async function initializeFaceCapture(): Promise<FaceLandmarker> {
  if (faceLandmarker) return faceLandmarker;
  if (isInitializing) {
    // Wait for initialization to complete
    while (isInitializing) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (faceLandmarker) return faceLandmarker;
  }

  isInitializing = true;
  try {
    const filesetResolver = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
    );

    faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-studio/latest/face_landmarker.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numFaces: 1,
    });

    console.log('[v0] FaceLandmarker initialized');
    return faceLandmarker;
  } finally {
    isInitializing = false;
  }
}

/**
 * Capture face mesh from video element
 */
export async function captureFaceMesh(
  videoElement: HTMLVideoElement,
  config: FaceCaptureConfig = {}
): Promise<FaceMesh | null> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const landmarker = await initializeFaceCapture();

  try {
    const result = landmarker.detectForVideo(videoElement, performance.now());

    if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
      return null;
    }

    const landmarks = result.faceLandmarks[0];
    const blendshapes = result.faceBlendshapes?.[0] ?? {};

    // Extract confidence as average of all landmark confidences
    const confidences = landmarks.map((l) => l.z ?? 1);
    const avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;

    if (avgConfidence < finalConfig.confidenceThreshold) {
      console.log('[v0] Face confidence below threshold:', avgConfidence);
      return null;
    }

    return {
      landmarks,
      blendshapes: blendshapes.reduce(
        (acc, shape) => {
          acc[shape.categoryName] = shape.score;
          return acc;
        },
        {} as Record<string, number>
      ),
      confidence: avgConfidence,
    };
  } catch (error) {
    console.error('[v0] Face capture error:', error);
    return null;
  }
}

/**
 * Batch capture frames at target FPS
 */
export async function captureFramesBatch(
  videoElement: HTMLVideoElement,
  durationMs: number,
  config: FaceCaptureConfig = {}
): Promise<FaceMesh[]> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const frameInterval = 1000 / finalConfig.fpsTarget;
  const meshes: FaceMesh[] = [];

  return new Promise((resolve) => {
    const startTime = Date.now();
    const captureFrame = async () => {
      const elapsedTime = Date.now() - startTime;

      if (elapsedTime >= durationMs) {
        resolve(meshes);
        return;
      }

      const mesh = await captureFaceMesh(videoElement, config);
      if (mesh) {
        meshes.push(mesh);
      }

      setTimeout(captureFrame, frameInterval);
    };

    captureFrame();
  });
}

/**
 * Compress face mesh data for upload (keep only key landmarks)
 */
export function compressMesh(mesh: FaceMesh): Record<string, unknown> {
  const keyLandmarks = [0, 1, 2, 3, 4, 10, 152, 159, 263, 269]; // Select key points
  const compressed = {
    keyLandmarks: keyLandmarks.map((idx) => ({
      idx,
      x: mesh.landmarks[idx].x,
      y: mesh.landmarks[idx].y,
      z: mesh.landmarks[idx].z ?? 0,
    })),
    blendshapes: mesh.blendshapes,
    confidence: mesh.confidence,
  };
  return compressed;
}

/**
 * Upload compressed face frames to backend
 */
export async function uploadFaceFrames(
  meshes: FaceMesh[],
  endpoint: string = '/api/face-capture'
): Promise<unknown> {
  const compressedData = meshes.map(compressMesh);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      frames: compressedData,
      timestamp: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get mesh visualization canvas overlay
 */
export function drawFaceMesh(
  canvas: HTMLCanvasElement,
  mesh: FaceMesh,
  videoWidth: number,
  videoHeight: number
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  canvas.width = videoWidth;
  canvas.height = videoHeight;

  // Clear canvas
  ctx.fillStyle = 'rgba(0, 0, 0, 0)';
  ctx.fillRect(0, 0, videoWidth, videoHeight);

  // Draw landmarks
  ctx.fillStyle = 'rgba(0, 255, 200, 0.5)';
  mesh.landmarks.forEach((landmark) => {
    const x = landmark.x * videoWidth;
    const y = landmark.y * videoHeight;
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
  });

  // Draw confidence indicator
  ctx.fillStyle = `rgba(0, 255, ${Math.round(mesh.confidence * 255)}, 0.7)`;
  ctx.font = '12px monospace';
  ctx.fillText(`Confidence: ${(mesh.confidence * 100).toFixed(1)}%`, 10, 20);
}
