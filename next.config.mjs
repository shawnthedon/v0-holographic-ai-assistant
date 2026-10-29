/** @type {import('next').NextConfig} */
const nextConfig = {
  // Type errors are no longer suppressed: `npx tsc --noEmit` is clean, so a
  // regression in the LLM layer should fail the build instead of shipping.
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
  /*
   * The browser agent launches a Chromium binary that is shipped inside
   * @sparticuz/chromium. Bundling it would try to trace a 50 MB executable and
   * its shared libraries into the server build, so both packages stay external.
   */
  serverExternalPackages: ['puppeteer-core', '@sparticuz/chromium'],
}

export default nextConfig
