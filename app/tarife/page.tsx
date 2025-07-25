import type { Metadata } from "next"
import Header from "@/components/header"
import PricingHero from "@/components/pricing-hero"
import PricingTable from "@/components/pricing-table"
import WhyChooseUsSection from "@/components/why-choose-us-section"
import FAQSection from "@/components/faq-section"
import Footer from "@/components/footer"
import Script from "next/script"

export const metadata: Metadata = {
  title: "Tarif OTP Parking - Parcare Otopeni Preț",
  description:
    "Cauți parcare Otopeni preț mic? La noi găsești probabil cel mai avantajos tarif pentru parcarea lângă aeroport. Rezervă acum!",
  keywords: [
    "tarife parcare otopeni",
    "preturi parcare aeroport",
    "parcare ieftina otopeni",
    "reduceri parcare aeroport",
  ],
  alternates: {
    canonical: "/tarife",
  },
  openGraph: {
    title: "Tarif OTP Parking - Parcare Otopeni Preț",
    description:
      "Cauți parcare Otopeni preț mic? La noi găsești probabil cel mai avantajos tarif pentru parcarea lângă aeroport. Rezervă acum!",
    url: "https://parcare-aeroport.ro/tarife",
  },
}

export default function PricingPage() {
  return (
    <main className="min-h-screen">
      {/* <Header /> */}
      <PricingHero />
      <PricingTable />
      <WhyChooseUsSection />
      <FAQSection />
      {/* <Footer /> */}

      {/* Schema.org pentru prețuri */}
      <Script id="schema-pricing" type="application/ld+json" strategy="afterInteractive">
        {`
          {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": "Parcare Otopeni",
            "description": "Parcare sigură lângă Aeroportul Otopeni",
            "offers": {
              "@type": "AggregateOffer",
              "lowPrice": "49.98",
              "highPrice": "350.00",
              "priceCurrency": "RON",
              "offerCount": "8",
              "offers": [
                {
                  "@type": "Offer",
                  "name": "Parcare 1 zi",
                  "price": "49.98",
                  "priceCurrency": "RON"
                },
                {
                  "@type": "Offer",
                  "name": "Parcare 7 zile",
                  "price": "220.00",
                  "priceCurrency": "RON"
                }
              ]
            }
          }
        `}
      </Script>
    </main>
  )
}
