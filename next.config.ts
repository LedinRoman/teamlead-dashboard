import type { NextConfig } from 'next';

const appPort = (process.env.PORT ?? process.env.APP_PORT ?? '80').replace(/^['"]|['"]$/g, '');
process.env.PORT ??= appPort;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  poweredByHeader: false,
  serverExternalPackages: ['pg'],
  outputFileTracingIncludes: {
    '*': ['./node_modules/pg/**/*'],
  },
};

export default nextConfig;
