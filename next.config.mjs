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
}

export default nextConfig
