import type { MetadataRoute } from 'next';

/**
 * PWA manifest.
 *
 * Installable, standalone, dark — and deliberately without screenshots or a
 * "rich install" prompt, because the console is not a marketing surface. The
 * service worker (`public/sw.js`) is what makes it work offline; this file only
 * tells the browser what it is installing.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'NEXUS // Holographic Intelligence Console',
    short_name: 'NEXUS',
    description:
      'A holographic AI console: on-device and cloud models, duplex voice, and artifacts that keep working offline.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#02080a',
    theme_color: '#02080a',
    categories: ['productivity', 'developer', 'utilities'],
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-dark-32x32.png', sizes: '32x32', type: 'image/png' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
    ],
  };
}
