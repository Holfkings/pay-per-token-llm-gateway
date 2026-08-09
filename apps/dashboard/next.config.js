const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  transpilePackages: ['@x402/types', '@x402/ui', '@x402/wallet', '@x402/authentication'],
  async rewrites() {
    return [
      {
        source: '/api/gateway/:path*',
        destination: `${GATEWAY_URL}/api/v1/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
