import { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  // Use the production domain as the default fallback.
  // Add NEXT_PUBLIC_APP_URL to your .env file to override this for local dev or staging.
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.anonymousU.live'

  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${baseUrl}/communities`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/wall`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.8,
    },
    // Note: Private routes like /settings, /profile, /admin, /onboarding 
    // and /friends have been omitted as they generally shouldn't be indexed by search engines.
  ]
}
