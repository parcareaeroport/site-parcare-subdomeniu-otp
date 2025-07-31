import { Metadata } from 'next'
import { TrackingPage } from '@/components/tracking-page'

export const metadata: Metadata = {
  title: 'Tracking',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    nosnippet: true,
    noarchive: true,
    noimageindex: true,
  },
  other: {
    'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex',
  },
}

export default function Page() {
  return <TrackingPage />
} 