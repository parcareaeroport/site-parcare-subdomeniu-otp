import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "QR",
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

export default function QrPage({
  searchParams,
}: {
  searchParams: { bookingNumber?: string; sig?: string }
}) {
  const bookingNumber = String(searchParams?.bookingNumber || "").trim()
  const sig = String(searchParams?.sig || "").trim()

  const imgSrc =
    bookingNumber && sig
      ? `/api/qr?bookingNumber=${encodeURIComponent(bookingNumber)}&sig=${encodeURIComponent(sig)}`
      : ""

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-md rounded-lg bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-gray-900">Cod QR acces parcare</h1>
        <p className="mt-2 text-sm text-gray-600">
          Acest cod QR este generat la deschiderea paginii.
        </p>

        {!bookingNumber || !sig ? (
          <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Link invalid (lipsește bookingNumber sau semnătura).
          </div>
        ) : (
          <div className="mt-6 flex flex-col items-center gap-3">
            <img
              src={imgSrc}
              alt="QR Code"
              className="h-64 w-64 rounded-md border border-gray-200 bg-white"
            />
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


