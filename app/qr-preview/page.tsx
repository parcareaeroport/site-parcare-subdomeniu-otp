import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { signQrBookingNumber } from "@/lib/qr-link"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "QR Preview",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    nosnippet: true,
    noarchive: true,
    noimageindex: true,
  },
  other: {
    "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet, noimageindex",
  },
}

export default async function QrPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; bookingNumber?: string }>
}) {
  const sp = await searchParams
  const token = String(sp?.token || "").trim()
  const expectedToken = String(
    process.env.QR_PREVIEW_TOKEN || process.env.EXTERNAL_BOOKING_TOKEN || ""
  ).trim()

  // Keep the page hidden: without the right token it behaves as if it doesn't exist.
  if (!expectedToken || !token || token !== expectedToken) {
    notFound()
  }

  const rawBookingNumber = String(sp?.bookingNumber || "123456").trim()
  const bookingNumber = rawBookingNumber.replace(/\D/g, "").slice(0, 6) || "123456"

  const secret = process.env.QR_LINK_SECRET
  const sig =
    secret && bookingNumber
      ? signQrBookingNumber(bookingNumber, secret)
      : process.env.NODE_ENV === "development"
        ? "dev"
        : ""

  const imgSrc =
    bookingNumber && sig
      ? `/api/qr?bookingNumber=${encodeURIComponent(bookingNumber)}&sig=${encodeURIComponent(sig)}`
      : ""
  const hasValidQr = Boolean(imgSrc)

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-md rounded-lg bg-white p-6 shadow-sm">
        <div className={hasValidQr ? "hidden sm:block" : ""}>
          <h1 className="text-lg font-semibold text-gray-900">Cod QR acces parcare</h1>
          <p className="mt-2 text-sm text-gray-600">
            Preview protejat pentru layout-ul real de QR.
          </p>
        </div>

        {!imgSrc ? (
          <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            QR indisponibil. Verifică variabilele `QR_LINK_SECRET` (prod) sau rulează în development.
          </div>
        ) : (
          <div className="mt-6 flex flex-col items-center gap-3">
            <img
              src={imgSrc}
              alt="QR Code"
              className="h-[114px] w-[114px] rounded-md border border-gray-200 bg-white sm:h-[170px] sm:w-[170px]"
            />
            <div className="text-center sm:hidden">
              <h1 className="text-base font-semibold text-gray-900">Cod QR acces parcare</h1>
              <p className="mt-1 text-xs text-gray-600">
                Preview protejat pentru layout-ul real de QR.
              </p>
            </div>
            <div className="text-xs text-gray-500">
              Booking: <span className="font-mono">{bookingNumber}</span>
            </div>
            <a
              className="text-sm font-medium text-[#ee7f1a] underline underline-offset-2 hover:no-underline"
              href={imgSrc}
              target="_blank"
              rel="noreferrer"
            >
              Deschide imaginea QR (PNG)
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
