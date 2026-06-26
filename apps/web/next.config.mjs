/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // shared-types is a workspace TS package consumed directly (no prebuild step).
  transpilePackages: ['@campusly/shared-types'],
};

export default nextConfig;
