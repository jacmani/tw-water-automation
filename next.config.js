/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },
  // `api.bodyParser` was a Pages-Router-only option (App Router route handlers don't
  // read it at all — this repo has never used the Pages Router). It did nothing except
  // print an "Invalid next.config.js options" warning on every single build/dev start.
};

module.exports = nextConfig;
