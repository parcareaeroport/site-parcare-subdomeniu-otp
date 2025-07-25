import type { Metadata } from "next"
import Header from "@/components/header"
import Footer from "@/components/footer"

export const metadata: Metadata = {
  title: "Politica de Anulare | Parcare-Aeroport Otopeni",
  description: "Informații despre politica de anulare a rezervărilor pentru parcarea de lângă Aeroportul Otopeni.",
  keywords: ["politica anulare", "anulare rezervare parcare", "rambursare parcare otopeni"],
  alternates: {
    canonical: "/politica-anulare",
  },
}

export default function CancellationPolicyPage() {
  return (
    <main className="min-h-screen bg-gray-50">
      {/* <Header /> */}
      <div className="container mx-auto px-4 py-12 md:py-16">
        <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8 mb-8">
          <h1 className="text-2xl md:text-3xl font-bold mb-6 text-center">Politica de Anulare</h1>

          <div className="prose prose-sm sm:prose max-w-none">
            <p>Ultima actualizare: {new Date().toLocaleDateString("ro-RO")}</p>

            <h2>1. Anularea rezervărilor</h2>
            <p>
              La Parcare-Aeroport Otopeni, înțelegem că planurile de călătorie se pot schimba. Politica noastră de
              anulare este concepută pentru a oferi flexibilitate, asigurând în același timp o gestionare eficientă a
              spațiului nostru de parcare.
            </p>

            <h3>1.1. Anulare cu cel puțin 24 de ore înainte</h3>
            <p>
              Rezervările anulate cu cel puțin 24 de ore înainte de ora programată de intrare în parcare sunt eligibile
              pentru o rambursare completă. Nu se aplică taxe de anulare.
            </p>

            <h3>1.2. Anulare cu mai puțin de 24 de ore înainte</h3>
            <p>
              Pentru anulările efectuate cu mai puțin de 24 de ore înainte de ora programată de intrare în parcare, se
              aplică o taxă de anulare de 50% din valoarea rezervării. Restul sumei va fi rambursat prin aceeași metodă
              de plată utilizată pentru rezervare.
            </p>

            <h3>1.3. Neprezentare (No-show)</h3>
            <p>
              În cazul neprezentării la data și ora rezervate, fără notificare prealabilă, rezervarea este considerată
              utilizată și nu se acordă nicio rambursare.
            </p>

            <h2>2. Modificarea rezervărilor</h2>
            <p>
              Modificările rezervărilor existente sunt permise în funcție de disponibilitate și de momentul solicitării.
            </p>

            <h3>2.1. Modificări cu cel puțin 24 de ore înainte</h3>
            <p>
              Modificările efectuate cu cel puțin 24 de ore înainte de ora programată de intrare în parcare pot fi
              făcute fără costuri suplimentare, sub rezerva disponibilității. Dacă noua rezervare are un cost mai mare,
              va trebui să plătiți diferența. Dacă noua rezervare are un cost mai mic, diferența va fi rambursată.
            </p>

            <h3>2.2. Modificări cu mai puțin de 24 de ore înainte</h3>
            <p>
              Modificările efectuate cu mai puțin de 24 de ore înainte de ora programată de intrare în parcare sunt
              supuse unei taxe administrative de 10% din valoarea rezervării inițiale, plus eventualele diferențe de
              cost pentru noua rezervare.
            </p>

            <h2>3. Procedura de anulare și rambursare</h2>
            <p>Pentru a anula o rezervare, vă rugăm să urmați unul dintre pașii de mai jos:</p>
            <ul>
              <li>Accesați link-ul de anulare din email-ul de confirmare a rezervării</li>
                              <li>Contactați serviciul nostru de relații cu clienții la numărul de telefon +40 734 292 818</li>
                              <li>Trimiteți un email la adresa contact.parcareaeroport@gmail.com cu numărul rezervării și detaliile dvs.</li>
            </ul>

            <p>
              Rambursările sunt procesate în termen de 5-10 zile lucrătoare și sunt efectuate prin aceeași metodă de
              plată utilizată pentru rezervare.
            </p>

            <h2>4. Circumstanțe excepționale</h2>
            <p>
              În cazul unor circumstanțe excepționale (dezastre naturale, urgențe medicale, etc.), politica de anulare
              poate fi flexibilizată. Aceste situații sunt evaluate de la caz la caz și pot necesita documente
              justificative.
            </p>

            <h2>5. Modificări ale politicii de anulare</h2>
            <p>
              Ne rezervăm dreptul de a modifica această politică de anulare în orice moment. Modificările vor fi
              publicate pe site-ul nostru și vor intra în vigoare imediat. Rezervările efectuate înainte de modificarea
              politicii vor respecta politica în vigoare la momentul rezervării.
            </p>

            <h2>6. Contact</h2>
            <p>
              Pentru orice întrebări sau clarificări privind politica noastră de anulare, vă rugăm să ne contactați la:
            </p>
            <ul>
                              <li>Telefon: +40 734 292 818</li>
                              <li>Email: contact.parcareaeroport@gmail.com</li>
                              <li>Adresă: Str. Calea Bucureştilor, Nr.303A1, Otopeni, Ilfov</li>
            </ul>
          </div>
        </div>
      </div>
      {/* <Footer /> */}
    </main>
  )
}
