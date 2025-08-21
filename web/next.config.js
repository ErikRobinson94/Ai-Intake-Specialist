/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable static HTML export (replaces `npx next export`)
  output: 'export',

  // Ensure images work in static export mode
  images: { unoptimized: true },

  // Keep clean URLs (no trailing slash). Change to `true` if you prefer `/index.html` style.
  trailingSlash: false,
};

module.exports = nextConfig;
