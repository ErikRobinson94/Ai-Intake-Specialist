/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 14+ static HTML export
  output: 'export',

  // Needed when exporting to static HTML
  images: { unoptimized: true },

  // Keep clean URLs
  trailingSlash: false,
};

module.exports = nextConfig;
