'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePower } from '@/hooks/use-power';
import { useReducedMotion } from '@/lib/hud/motion';

/**
 * HOLOGRAPHIC BACKDROP — the studio’s ambient clip.
 *
 * The plate is a still image; the *clip* is a fragment shader that keeps it
 * moving in depth: luminance decides how far each pixel sits from the glass, so
 * the bright subject drifts against the dark room, gets a radial chromatic
 * fringe, a laser sweep, a refresh band, motes and a travelling vignette. That
 * reads as a hologram because the layers move at different rates — not because
 * anything is randomly wobbling.
 *
 * Contract:
 *   • the image is composited at **30% opacity** at every moment (one alpha
 *     uniform, never per-layer opacity drift);
 *   • it is decoration: `aria-hidden`, `pointer-events: none`, no text that
 *     claims to be data except the real loop timecode;
 *   • reduced motion and missing WebGL fall back to a still frame of the same
 *     plate at the same opacity;
 *   • the frame budget comes from the power governor (and stops entirely when
 *     the tab is hidden), so this never fights the console for frames.
 */

export const HOLO_PLATE = '/holo/neural-scan.jpg';
/** Exactly 30%, as specified. Exported so tests can assert the contract. */
export const HOLO_OPACITY = 0.3;
/**
 * Sampling scale. The plate is portrait (768×1376); a landscape dialog crops it
 * hard, so we sample ~19% more of it and let the clamped edges fall into the
 * vignette. That keeps the ring structure and the projector base in frame.
 */
export const HOLO_ZOOM = 0.84;

const VERTEX = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAGMENT = `
precision highp float;

uniform sampler2D uTex;
uniform vec2 uRes;
uniform vec2 uPointer;
uniform float uTime;
uniform float uOpacity;
uniform float uEnergy;
uniform float uTextureAspect;
uniform float uViewAspect;
uniform float uZoom;

varying vec2 vUv;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

/* cover-fit: fill the canvas, crop the overflow, never squash the plate */
vec2 coverUv(vec2 uv) {
  vec2 scale = vec2(1.0);
  if (uViewAspect > uTextureAspect) {
    scale.y = uTextureAspect / uViewAspect;
  } else {
    scale.x = uViewAspect / uTextureAspect;
  }
  return (uv - 0.5) * scale / uZoom + 0.5;
}

void main() {
  vec2 uv = coverUv(vUv);

  vec3 plate = texture2D(uTex, uv).rgb;
  float luma = dot(plate, vec3(0.299, 0.587, 0.114));
  float depth = smoothstep(0.04, 0.72, luma);

  /* orbit + pointer tilt; the subject moves more than the room behind it */
  vec2 drift = vec2(sin(uTime * 0.043), cos(uTime * 0.031)) * 0.007 * uEnergy;
  vec2 tilt = uPointer * vec2(0.018, 0.011) * (0.30 + depth * 1.10) * uEnergy;
  vec2 sampleUv = uv + drift + tilt;

  /* volumetric expansion: near pixels push outward from the projection centre */
  sampleUv += (sampleUv - 0.5) * (0.010 + 0.026 * depth) * uEnergy;

  vec2 radial = normalize(sampleUv - 0.5 + vec2(1e-5));
  float ab = (0.0011 + 0.0032 * depth) * uEnergy;

  vec3 colour;
  colour.r = texture2D(uTex, sampleUv + radial * ab).r;
  colour.g = texture2D(uTex, sampleUv).g;
  colour.b = texture2D(uTex, sampleUv - radial * ab).b;

  /* a second, deeper layer: the hologram has volume behind the glass */
  vec3 ghost = texture2D(uTex, sampleUv + radial * (0.006 + 0.014 * depth)).rgb;
  colour += ghost * 0.16 * uEnergy;

  colour *= vec3(0.84, 1.02, 1.08);
  colour += pow(max(colour, vec3(0.0)), vec3(2.4)) * 0.62;

  float y = 1.0 - vUv.y;

  /* the plate's laser: one bright line plus its halo */
  float sweep = fract(uTime * 0.043);
  float band = exp(-pow((y - sweep) * 70.0, 2.0));
  float halo = exp(-pow((y - sweep) * 11.0, 2.0)) * 0.20;
  colour += vec3(0.42, 1.0, 0.30) * (band * 0.42 + halo) * uEnergy;

  /* refresh band travelling the other way */
  float refresh = fract(1.0 - uTime * 0.017);
  colour += vec3(0.32, 0.88, 1.0) * exp(-pow((y - refresh) * 240.0, 2.0)) * 0.30 * uEnergy;

  /* screen-door scanlines */
  float scan = 0.90 + 0.10 * sin(vUv.y * uRes.y * 1.7);
  colour *= mix(1.0, scan, 0.5 * uEnergy);

  /* data motes only where the plate is dark */
  vec2 cell = floor(vUv * vec2(150.0, 260.0));
  float mote = step(0.9955, hash21(cell + floor(uTime * 6.0)));
  colour += vec3(0.55, 0.95, 0.85) * mote * (1.0 - depth) * 0.40 * uEnergy;

  /* hologram flicker — small, slow, never a strobe */
  colour *= 0.965 + 0.035 * sin(uTime * 7.1) * sin(uTime * 2.3);

  /*
   * smoothstep needs edge0 < edge1; the first version passed them the other way
   * round, which is undefined in GLSL and rendered almost black on SwiftShader.
   * The mask now fades *out* towards the frame, and the plate gets a modest gain
   * so 30% alpha still reads on a black console.
   */
  float vignetteRadius = length((vUv - 0.5) * vec2(1.06, 1.0));
  float vignette = 1.0 - smoothstep(0.32, 0.98, vignetteRadius);
  /*
   * Emissive lift. The plate is a dark photograph (mean luminance ≈ 21%), so at a
   * 30% composite it would be almost invisible. A modest gain plus a gamma lift
   * keeps the opacity contract while letting the hologram read through the UI.
   */
  colour = pow(max(colour, vec3(0.0)) * 1.18, vec3(0.88));
  /* keep the plate present but recessive: 30% alpha, and a tone ceiling that
     leaves text on top of it legible */
  colour *= mix(0.34, 1.0, vignette) * 0.62;

  float alpha = uOpacity * mix(0.22, 1.0, vignette);
  /* premultiplied: rgb already scaled by alpha */
  gl_FragColor = vec4(colour * alpha, alpha);
}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export interface HoloBackdropProps {
  /** Optional className for the canvas itself. */
  className?: string;
  /** Loop timecode, reported from the real clip clock (never fabricated). */
  onTimecode?: (seconds: number) => void;
}

export function HoloBackdrop({ className, onTimecode }: HoloBackdropProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const plateRef = useRef<HTMLImageElement>(null);
  const pointer = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const [mode, setMode] = useState<'webgl' | 'static'>('static');
  const power = usePower();
  const reduced = useReducedMotion();

  /*
   * Live values the render loop reads every frame. They are kept in a ref so a
   * governor change or a new callback never re-creates the WebGL context (an
   * effect that re-ran on those deps used to delete the texture the loop was
   * still sampling).
   */
  const runtimeRef = useRef({ fpsCap: power.fpsCap, hidden: power.hidden, reduced, onTimecode });
  runtimeRef.current.fpsCap = power.fpsCap;
  runtimeRef.current.hidden = power.hidden;
  runtimeRef.current.reduced = reduced;
  runtimeRef.current.onTimecode = onTimecode;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl =
      canvas.getContext('webgl', {
        alpha: true,
        /* premultiplied output — see the blend setup below */
        premultipliedAlpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: 'low-power',
      }) ?? null;

    if (!gl) {
      setMode('static');
      return;
    }

    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) {
      setMode('static');
      return;
    }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      setMode('static');
      return;
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uniforms = {
      tex: gl.getUniformLocation(program, 'uTex'),
      res: gl.getUniformLocation(program, 'uRes'),
      pointer: gl.getUniformLocation(program, 'uPointer'),
      time: gl.getUniformLocation(program, 'uTime'),
      opacity: gl.getUniformLocation(program, 'uOpacity'),
      energy: gl.getUniformLocation(program, 'uEnergy'),
      textureAspect: gl.getUniformLocation(program, 'uTextureAspect'),
      viewAspect: gl.getUniformLocation(program, 'uViewAspect'),
      zoom: gl.getUniformLocation(program, 'uZoom'),
    };

    gl.enable(gl.BLEND);
    /*
     * Premultiplied blending (ONE, ONE_MINUS_SRC_ALPHA) with premultiplied
     * fragment output. The earlier SRC_ALPHA blend on an unpremultiplied buffer
     * made the compositor multiply by alpha a second time, so a 30% plate
     * rendered at 9% — which is why the hologram looked switched off.
     */
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    /* 1×1 dark pixel until the plate decodes — nothing is invented meanwhile */
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([4, 12, 16, 255]));
    gl.uniform1i(uniforms.tex, 0);

    let textureAspect = 768 / 1376;
    let disposed = false;
    let frame = 0;
    let lastDraw = 0;
    let start = 0;
    let elapsed = 0;
    let uploaded = false;
    let drewStill = false;

    const runtime = runtimeRef.current;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
    };

    const draw = (time: number) => {
      resize();
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uniforms.res, canvas.width, canvas.height);
      gl.uniform2f(uniforms.pointer, pointer.current.x, pointer.current.y);
      gl.uniform1f(uniforms.time, time);
      gl.uniform1f(uniforms.opacity, HOLO_OPACITY);
      gl.uniform1f(uniforms.energy, runtime.reduced ? 0.35 : 1.0);
      gl.uniform1f(uniforms.textureAspect, textureAspect);
      gl.uniform1f(uniforms.viewAspect, canvas.width / Math.max(1, canvas.height));
      gl.uniform1f(uniforms.zoom, HOLO_ZOOM);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    /*
     * The plate is uploaded from a real <img> that React renders, not from a
     * detached Image(): the element is guaranteed to be complete when `load`
     * fires, so the texture is never a placeholder that silently samples black.
     */
    const upload = (source: HTMLImageElement) => {
      if (disposed || uploaded || !source.naturalWidth) return;
      textureAspect = source.naturalWidth / Math.max(1, source.naturalHeight);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      uploaded = true;
      setMode('webgl');
      draw(0.8);
    };

    const plate = plateRef.current;
    if (plate && plate.complete && plate.naturalWidth > 0) {
      upload(plate);
    } else {
      plate?.addEventListener('load', () => upload(plate), { once: true });
    }

    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (runtime.hidden) return;
      if (runtime.reduced) {
        if (!drewStill && uploaded) {
          draw(0.8);
          drewStill = true;
          /* one still frame is the whole animation in this mode — stop the loop */
          canvas.dataset.holoReduced = 'true';
          cancelAnimationFrame(frame);
        }
        return;
      }
      if (!start) start = now;
      const budget = 1000 / Math.max(12, runtime.fpsCap);
      if (now - lastDraw < budget) {
        return;
      }
      lastDraw = now;
      elapsed = (now - start) / 1000;

      /* pointer easing: the parallax settles instead of snapping */
      pointer.current.x += (pointer.current.tx - pointer.current.x) * 0.06;
      pointer.current.y += (pointer.current.ty - pointer.current.y) * 0.06;

      draw(elapsed);
      runtime.onTimecode?.(elapsed);
    };

    const onPointer = (event: PointerEvent) => {
      pointer.current.tx = (event.clientX / window.innerWidth - 0.5) * 2;
      pointer.current.ty = (event.clientY / window.innerHeight - 0.5) * 2;
    };

    window.addEventListener('pointermove', onPointer, { passive: true });
    frame = requestAnimationFrame(loop);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onPointer);
      gl.deleteTexture(texture);
      gl.deleteProgram(program);
      gl.deleteBuffer(buffer);
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        data-holo={mode}
        data-holo-opacity={String(HOLO_OPACITY)}
        data-testid="holo-backdrop"
        className={className}
        style={{ width: '100%', height: '100%', display: 'block', opacity: 1 }}
      />
      {/* the source plate: a real element, so `load` guarantees a complete texture */}
      <img
        ref={plateRef}
        src={HOLO_PLATE}
        alt=""
        aria-hidden="true"
        decoding="async"
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />
    </>
  );
}

/**
 * The clip as a framed element: the animated plate plus the console’s own
 * scanline/grid materials, corner brackets and a *real* loop timecode.
 *
 * The timecode is the animation clock, labelled AMBIENT — it is not activity
 * from an agent, and the studio never presents it as such.
 */
export function HoloBackdropClip({ intensity = 1 }: { intensity?: number }) {
  const [seconds, setSeconds] = useState(0);
  const [prefersStill, setPrefersStill] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersStill(query.matches);
  }, []);

  const report = useCallback((value: number) => {
    const next = Math.floor(value);
    setSeconds((current) => (current === next ? current : next));
  }, []);

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0" style={{ opacity: intensity }}>
        <HoloBackdrop onTimecode={report} />
      </div>

      {/* the console’s own holographic materials, kept at the same 30% ceiling */}
      <div className="holo-scanlines absolute inset-0 opacity-[0.16]" />
      <div className="holo-grid absolute inset-0 opacity-[0.10]" />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 46%, rgba(2,10,13,0) 46%, rgba(2,10,13,0.28) 82%, rgba(1,5,7,0.62) 100%)',
        }}
      />

      {/* clip chrome */}
      <div className="absolute bottom-8 right-3 hidden items-center gap-2 font-mono text-[7px] uppercase tracking-[0.3em] text-[color:var(--hud-ink-dim)] md:flex">
        <span className="h-[5px] w-[5px] rounded-full bg-[color:var(--hud-lime)] shadow-[0_0_8px_var(--hud-lime)]" />
        ambient plate · {mm}:{ss}
        {prefersStill ? ' · still' : ''}
      </div>
      <div className="absolute bottom-4 right-3 font-mono text-[6px] uppercase tracking-[0.28em] text-[color:var(--hud-ink-dim)] opacity-60">
        neural scan · 01001 · holographic plate
      </div>
      <div className="absolute inset-x-3 bottom-[2px] h-[1px] bg-[color:var(--hud-line)] opacity-40">
        <div
          className="h-[1px] bg-[color:var(--hud-ink)]/70"
          style={{ width: `${((seconds % 60) / 60) * 100}%` }}
        />
      </div>
    </div>
  );
}
