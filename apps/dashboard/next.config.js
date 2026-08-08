/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@x402/types', '@x402/ui', '@x402/wallet', '@x402/authentication'],
  async rewrites() {
    return [
      {
        source: '/api/gateway/:path*',
        destination: 'http://localhost:3000/api/v1/:path*',
      },
    ];
  },
};

module.exports = nextConfig;
