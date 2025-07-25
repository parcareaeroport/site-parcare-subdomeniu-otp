import type { Metadata } from "next"
import Header from "@/components/header"
import Footer from "@/components/footer"
import ParkingRulesHero from "@/components/parking-rules-hero"
import ParkingRulesTabs from "@/components/parking-rules-tabs"
import GeneralRulesSection from "@/components/general-rules-section"
import FAQSection from "@/components/faq-section"

export const metadata: Metadata = {
  title: "Regulile Parcării Otopeni | Informații Importante pentru Șoferi",
  description:
    "Consultă regulile parcării de lângă Aeroportul Otopeni. Informații despre intrare, ieșire, plată și alte aspecte importante pentru o experiență fără probleme.",
  keywords: ["reguli parcare otopeni", "cum functioneaza parcare aeroport", "informatii parcare otopeni"],
  alternates: {
    canonical: "/reguli",
  },
  openGraph: {
    title: "Regulile Parcării Otopeni | Informații Importante pentru Șoferi",
    description:
      "Consultă regulile parcării de lângă Aeroportul Otopeni. Informații despre intrare, ieșire, plată și alte aspecte importante pentru o experiență fără probleme.",
    url: "https://rezervari.otp-parking.ro/reguli",
  },
}

export default function RulesPage() {
  return (
    <main className="min-h-screen">
      {/* <Header /> */}
      <ParkingRulesHero />
      <ParkingRulesTabs />
      <GeneralRulesSection />
      <FAQSection />
      {/* <Footer /> */}
    </main>
  )
}
