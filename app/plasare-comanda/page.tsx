import type { Metadata } from "next"
import Header from "@/components/header"
import Footer from "@/components/footer"
import OrderPlacementForm from "@/components/order-placement-form"
import CheckoutSteps from "@/components/checkout-steps"

export const metadata: Metadata = {
  title: "Plasare Comandă | Parcare-Aeroport Otopeni",
  description:
    "Finalizează rezervarea locului de parcare la Aeroportul Otopeni. Completează datele și alege metoda de plată.",
  keywords: [
    "rezervare parcare otopeni",
    "plată parcare aeroport",
    "finalizare comandă parcare",
    "checkout parcare otopeni",
  ],
  alternates: {
    canonical: "/plasare-comanda",
  },
}

export default function OrderPlacementPage() {
  return (
    <main className="min-h-screen bg-gray-50">
      {/* <Header /> */}
      <div className="container mx-auto px-4 py-8 md:py-12">
        <CheckoutSteps activeStep={2} />
        <OrderPlacementForm />
      </div>
      {/* <Footer /> */}
    </main>
  )
}
