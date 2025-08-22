/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export for Next 14+
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: false,
  reactStrictMode: true,
};

module.exports = nextConfig;
