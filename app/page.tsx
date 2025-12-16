import type { Metadata } from "next"
import RedirectToAdmin from "./_redirect-to-admin"

export const metadata: Metadata = {
  title: "Admin",
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
}

export default function Home() {
  // Root should always forward to /admin; auth gating happens on /admin.
  return <RedirectToAdmin />
}
