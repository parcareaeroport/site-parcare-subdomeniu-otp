import type { Metadata } from "next"
import Header from "@/components/header"
import Footer from "@/components/footer"
import CancellationForm from "@/components/cancellation-form"

export const metadata: Metadata = {
  title: "Anulare Rezervare | Parcare-Aeroport Otopeni",
  description:
    "Anulați rezervarea locului de parcare la Aeroportul Otopeni. Completați formularul pentru returnarea costurilor.",
  keywords: [
    "anulare rezervare parcare otopeni",
    "anulare parcare aeroport",
    "anulare parcare otopeni",
    "rambursare parcare aeroport",
  ],
  alternates: {
    canonical: "/anulare",
  },
}

export default function CancellationPage() {
  return (
    <main className="min-h-screen bg-gray-50">
      {/* <Header /> */}
      <div className="container mx-auto px-4 py-8 md:py-12">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 md:p-8">
            <div className="text-center mb-8">
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-4">
                Anulare Rezervare
              </h1>
              <p className="text-gray-600 leading-relaxed">
                În cazul în care doriți anularea rezervării, vă rugăm să completați formularul de mai jos cu 
                <strong className="text-primary"> minim 24 de ore înainte de ora sosirii</strong>. 
                Costul acesteia va fi returnat în contul dumneavoastră în 
                <strong className="text-primary"> maxim 7 zile lucrătoare</strong>.
              </p>
            </div>
            
            <CancellationForm />
          </div>
        </div>
      </div>
      {/* <Footer /> */}
    </main>
  )
} 