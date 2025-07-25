import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        disallow: '/',
      }
    ],
    // Removing sitemap and host since we don't want any indexing
  }
}
