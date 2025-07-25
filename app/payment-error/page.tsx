import type { Metadata } from "next"
import { Suspense } from "react"
import Header from "@/components/header"
import Footer from "@/components/footer"
import PaymentErrorContent from "@/components/payment-error-content"

export const metadata: Metadata = {
  title: "Eroare Plată | rezervari.otp-parking Otopeni",
  description: "A apărut o problemă cu plata. Încearcă din nou sau contactează-ne pentru suport.",
  robots: "noindex, nofollow"
}

export default function PaymentErrorPage() {
  return (
    <main className="min-h-screen bg-gray-50">
      {/* <Header /> */}
      <div className="container mx-auto px-4 py-8 md:py-12">
        <Suspense fallback={
          <div className="max-w-4xl mx-auto">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8 text-center">
              <div className="animate-pulse space-y-4">
                <div className="h-16 w-16 bg-gray-200 rounded-full mx-auto"></div>
                <div className="h-8 bg-gray-200 rounded w-3/4 mx-auto"></div>
                <div className="h-4 bg-gray-200 rounded w-1/2 mx-auto"></div>
              </div>
            </div>
          </div>
        }>
          <PaymentErrorContent />
        </Suspense>
      </div>
      {/* <Footer /> */}
    </main>
  )
} 