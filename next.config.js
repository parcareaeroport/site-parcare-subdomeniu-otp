/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: '/returnare',
        destination: '/anulare',
        permanent: true,
      },
    ]
  },
}

module.exports = nextConfig 