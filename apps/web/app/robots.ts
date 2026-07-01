import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.anonymousU.live'

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin/', '/settings/', '/profile/', '/onboarding/', '/friends/'],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  }
}
