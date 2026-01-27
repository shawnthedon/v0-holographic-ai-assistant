'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { motion } from 'framer-motion';

interface AvatarSceneProps {
  onInitialize?: (speakAudioCallback: (audioData: ArrayBuffer, sampleRate: number) => void) => void;
  isListening?: boolean;
  isSpeaking?: boolean;
}

export function AvatarScene({ onInitialize, isListening = false, isSpeaking = false }: AvatarSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const avatarRef = useRef<THREE.Group | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const floatingAnimationRef = useRef<number>(0);
  const breathingAnimationRef = useRef<number>(0);
  const eyeDartAnimationRef = useRef<number>(0);
  const morphTargets = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    try {
      // Initialize Three.js scene
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x000000); // Pure black for Pepper's Ghost
      sceneRef.current = scene;

      // Camera setup
      const camera = new THREE.PerspectiveCamera(
        75,
        containerRef.current.clientWidth / containerRef.current.clientHeight,
        0.1,
        1000
      );
      camera.position.z = 2;
      cameraRef.current = camera;

      // Renderer setup
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
      renderer.setClearColor(0x000000, 1);
      containerRef.current.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      // Lighting setup for holographic effect
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
      scene.add(ambientLight);

      // Key lights for holographic effect
      const keyLight = new THREE.DirectionalLight(0x00d9ff, 1.2);
      keyLight.position.set(5, 5, 5);
      scene.add(keyLight);

      const rimLight = new THREE.DirectionalLight(0xff006e, 0.8);
      rimLight.position.set(-5, 3, -5);
      scene.add(rimLight);

      // Create procedural avatar (fallback if model file doesn't exist)
      const createProceduralAvatar = () => {
        const avatar = new THREE.Group();

        // Head (sphere)
        const headGeometry = new THREE.SphereGeometry(0.4, 32, 32);
        const headMaterial = new THREE.MeshStandardMaterial({
          color: 0xffdbac,
          emissive: 0x00d9ff,
          emissiveIntensity: 0.2,
          roughness: 0.3,
          metalness: 0.1,
        });
        const head = new THREE.Mesh(headGeometry, headMaterial);
        head.position.y = 0.6;
        avatar.add(head);

        // Eyes
        const eyeGeometry = new THREE.SphereGeometry(0.1, 16, 16);
        const eyeMaterial = new THREE.MeshStandardMaterial({
          color: 0x0066ff,
          emissive: 0x00d9ff,
          emissiveIntensity: 0.4,
        });
        const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        leftEye.position.set(-0.15, 0.8, 0.35);
        avatar.add(leftEye);

        const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial.clone());
        rightEye.position.set(0.15, 0.8, 0.35);
        avatar.add(rightEye);

        // Mouth (torus for lip-sync)
        const mouthGeometry = new THREE.TorusGeometry(0.15, 0.04, 16, 32);
        const mouthMaterial = new THREE.MeshStandardMaterial({
          color: 0xff006e,
          emissive: 0xff006e,
          emissiveIntensity: 0.3,
        });
        const mouth = new THREE.Mesh(mouthGeometry, mouthMaterial);
        mouth.position.set(0, 0.35, 0.38);
        mouth.rotation.x = Math.PI / 2;
        avatar.add(mouth);

        // Neck
        const neckGeometry = new THREE.CylinderGeometry(0.2, 0.25, 0.4, 16);
        const neckMaterial = new THREE.MeshStandardMaterial({
          color: 0xffdbac,
          emissive: 0x00d9ff,
          emissiveIntensity: 0.1,
        });
        const neck = new THREE.Mesh(neckGeometry, neckMaterial);
        neck.position.y = 0.2;
        avatar.add(neck);

        // Body (capsule shape)
        const bodyGeometry = new THREE.CylinderGeometry(0.3, 0.25, 0.8, 16);
        const bodyMaterial = new THREE.MeshStandardMaterial({
          color: 0x1a1a2e,
          emissive: 0x00d9ff,
          emissiveIntensity: 0.15,
          roughness: 0.4,
        });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = -0.4;
        avatar.add(body);

        // Store references for animations
        morphTargets.current = { head, leftEye, rightEye, mouth, body };

        return avatar;
      };

      // Try to load from GLB file, fallback to procedural
      const loader = new GLTFLoader();
      let avatarLoaded = false;

      loader.load(
        '/models/avatar.glb',
        (gltf) => {
          const avatar = gltf.scene;
          avatar.scale.set(1.5, 1.5, 1.5);
          avatar.position.y = -0.3;
          scene.add(avatar);
          avatarRef.current = avatar;
          avatarLoaded = true;
          setIsLoading(false);

          // Apply materials for holographic effect
          avatar.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              if (mesh.material) {
                const mat = mesh.material as THREE.Material;
                if ('emissive' in mat) {
                  (mat as any).emissive = new THREE.Color(0x00d9ff);
                  (mat as any).emissiveIntensity = 0.2;
                }
              }
            }
          });
        },
        undefined,
        (err) => {
          console.log('[v0] Avatar model not found, using procedural avatar:', err.message);
          
          // Fallback: create procedural avatar
          const avatar = createProceduralAvatar();
          avatar.scale.set(1.5, 1.5, 1.5);
          avatar.position.y = -0.3;
          scene.add(avatar);
          avatarRef.current = avatar;
          setIsLoading(false);
        }
      );

      // Animation loop with floating effect, breathing, and eye darting
      const animate = () => {
        floatingAnimationRef.current = requestAnimationFrame(animate);

        if (avatarRef.current) {
          // Floating effect
          avatarRef.current.position.y = -0.3 + Math.sin(Date.now() * 0.001) * 0.1;

          // Breathing animation when listening (subtle scale change)
          if (isListening && !isSpeaking) {
            const breathingScale = 1 + Math.sin(Date.now() * 0.003) * 0.02;
            avatarRef.current.scale.set(breathingScale, breathingScale, breathingScale);
          } else {
            avatarRef.current.scale.set(1, 1, 1);
          }

          // Subtle rotation
          avatarRef.current.rotation.y += 0.002;

          // Eye darting animation when listening (occasional head tilt)
          if (isListening && !isSpeaking) {
            const eyeDartTime = (Date.now() * 0.005) % (Math.PI * 2);
            const eyeDartAmount = Math.sin(eyeDartTime) * 0.03;
            avatarRef.current.rotation.z = eyeDartAmount;

            // Occasional head tilt
            if (Math.sin(Date.now() * 0.001) > 0.8) {
              avatarRef.current.rotation.x = Math.sin(Date.now() * 0.002) * 0.05;
            }
          } else {
            avatarRef.current.rotation.z = 0;
            avatarRef.current.rotation.x = 0;
          }

          // Mouth animation when speaking (torus scale)
          if (morphTargets.current?.mouth && isSpeaking) {
            const mouthOpen = Math.sin(Date.now() * 0.01) * 0.3 + 0.5;
            morphTargets.current.mouth.scale.y = mouthOpen;
          } else if (morphTargets.current?.mouth) {
            morphTargets.current.mouth.scale.y = 1;
          }
        }

        renderer.render(scene, camera);
      };
      animate();

      // Handle window resize
      const handleResize = () => {
        if (!containerRef.current) return;

        const width = containerRef.current.clientWidth;
        const height = containerRef.current.clientHeight;

        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
      };

      window.addEventListener('resize', handleResize);

      // Cleanup
      return () => {
        window.removeEventListener('resize', handleResize);
        if (floatingAnimationRef.current) {
          cancelAnimationFrame(floatingAnimationRef.current);
        }
        renderer.dispose();
        containerRef.current?.removeChild(renderer.domElement);
      };
    } catch (err) {
      console.error('Scene initialization error:', err);
      setError('Failed to initialize 3D scene');
    }
  }, []);

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      <div ref={containerRef} className="w-full h-full" />

      {isLoading && (
        <motion.div
          className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          animate={{ opacity: 0 }}
          transition={{ delay: 1.5, duration: 0.5 }}
          pointerEvents="none"
        >
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-cyan-400 text-sm font-mono">Initializing hologram...</p>
          </div>
        </motion.div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/90 backdrop-blur-sm">
          <motion.div
            className="text-center"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <p className="text-yellow-400 text-sm font-mono mb-2">Warning</p>
            <p className="text-gray-300 text-xs max-w-xs">{error}</p>
            <p className="text-gray-500 text-xs mt-3">Using procedural avatar</p>
          </motion.div>
        </div>
      )}
    </div>
  );
}
