import type { Metadata } from "next"
import Header from "@/components/header"
import Footer from "@/components/footer"

export const metadata: Metadata = {
  title: "Termeni de Utilizare site | Parcare-Aeroport Otopeni",
  description: "Termenii și condițiile de utilizare a serviciilor de parcare oferite de Parcare-Aeroport Otopeni.",
  keywords: ["termeni utilizare", "conditii parcare", "reguli parcare otopeni"],
  alternates: {
    canonical: "/termeni",
  },
}

export default function TermsOfServicePage() {
  return (
    <main className="min-h-screen bg-gray-50">
      {/* <Header /> */}
      <div className="container mx-auto px-4 py-12 md:py-16">
        <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8 mb-8">
          <h1 className="text-2xl md:text-3xl font-bold mb-6 text-center">Termeni de Utilizare</h1>

          <div className="prose prose-sm sm:prose max-w-none">
            <p>Ultima actualizare: {new Date().toLocaleDateString("ro-RO")}</p>

            <p>
              Vă rugăm să citiți cu atenție acești Termeni de Utilizare ("Termeni") înainte de a utiliza site-ul web
              parcare-aeroport.ro și serviciile de parcare oferite de Parcare-Aeroport SRL ("Compania", "noi", "nouă"
              sau "nostru").
            </p>

            <p>
              Accesarea sau utilizarea Serviciului înseamnă că sunteți de acord să respectați acești Termeni. Dacă nu
              sunteți de acord cu orice parte a termenilor, nu puteți accesa Serviciul.
            </p>

            <h2>1. Definiții</h2>
            <ul>
              <li>
                <strong>Serviciul</strong> se referă la site-ul web parcare-aeroport.ro și serviciile de parcare oferite
                de Parcare-Aeroport SRL.
              </li>
              <li>
                <strong>Utilizator</strong> se referă la persoana care accesează sau utilizează Serviciul.
              </li>
              <li>
                <strong>Client</strong> se referă la persoana sau entitatea care efectuează o rezervare și utilizează
                serviciile de parcare.
              </li>
              <li>
                <strong>Rezervare</strong> se referă la acordul dintre Client și Companie pentru utilizarea unui loc de
                parcare pentru o perioadă specificată.
              </li>
            </ul>

            <h2>2. Utilizarea Serviciului</h2>

            <h3>2.1. Eligibilitate</h3>
            <p>
              Pentru a utiliza Serviciul, trebuie să aveți cel puțin 18 ani și să dețineți capacitatea legală de a
              încheia un contract.
            </p>

            <h3>2.2. Înregistrare și cont</h3>
            <p>
              Când vă înregistrați pentru un cont, trebuie să furnizați informații corecte, complete și actualizate.
              Este responsabilitatea dvs. să vă protejați parola și să notificați Compania în cazul oricărei utilizări
              neautorizate a contului dvs.
            </p>

            <h3>2.3. Rezervări</h3>
            <p>
              Rezervările sunt supuse disponibilității și confirmării din partea Companiei. O rezervare este considerată
              confirmată doar după primirea unui email de confirmare și procesarea cu succes a plății.
            </p>

            <h2>3. Reguli de parcare</h2>

            <h3>3.1. Accesul în parcare</h3>
            <p>
              Accesul în parcare este permis cu maxim 2 ore înainte de ora de începere a rezervării. Accesul în afara
              acestui interval poate fi supus unor taxe suplimentare.
            </p>

            <h3>3.2. Comportament în parcare</h3>
            <p>În timp ce utilizați parcarea, sunteți obligat să:</p>
            <ul>
              <li>Respectați toate semnele și instrucțiunile afișate</li>
              <li>Parcați doar în spațiile desemnate</li>
              <li>Mențineți o viteză de deplasare sigură (max. 5 km/h)</li>
              <li>Nu blocați alte vehicule sau căi de acces</li>
              <li>Nu efectuați reparații sau întreținere a vehiculului în incinta parcării</li>
              <li>Nu aruncați gunoi sau substanțe periculoase</li>
            </ul>

            <h3>3.3. Responsabilitate pentru vehicul și bunuri</h3>
            <p>
              Compania nu este responsabilă pentru pierderea sau deteriorarea vehiculului sau a bunurilor lăsate în
              vehicul. Vă recomandăm să nu lăsați obiecte de valoare în vehicul și să vă asigurați că vehiculul este
              încuiat corespunzător.
            </p>

            <h2>4. Plăți și taxe</h2>

            <h3>4.1. Prețuri</h3>
            <p>
              Toate prețurile afișate includ TVA și sunt în moneda specificată (RON). Compania își rezervă dreptul de a
              modifica prețurile în orice moment, dar modificările nu vor afecta rezervările deja confirmate.
            </p>

            <h3>4.2. Metode de plată</h3>
            <p>
              Acceptăm plăți prin card de credit/debit și alte metode specificate pe site. Toate tranzacțiile sunt
              procesate prin furnizori de servicii de plată securizați.
            </p>

            <h3>4.3. Taxe suplimentare</h3>
            <p>Pot fi aplicate taxe suplimentare pentru:</p>
            <ul>
              <li>Depășirea perioadei rezervate</li>
              <li>Pierderea tichetului de parcare</li>
              <li>Daune cauzate proprietății Companiei</li>
              <li>Servicii suplimentare solicitate</li>
            </ul>

            <h2>5. Anulări și modificări</h2>
            <p>
              Politica de anulare și modificare a rezervărilor este detaliată în Politica de Anulare, disponibilă pe
              site-ul nostru.
            </p>

            <h2>6. Limitarea răspunderii</h2>
            <p>
              În măsura permisă de lege, Compania nu va fi responsabilă pentru daune indirecte, incidentale, speciale,
              consecutive sau punitive, inclusiv pierderea de profit, date sau utilizare, rezultate din sau în legătură
              cu utilizarea Serviciului.
            </p>
            <p>
              Răspunderea totală a Companiei pentru orice reclamație legată de Serviciu nu va depăși suma plătită de
              Client pentru rezervarea în cauză.
            </p>

            <h2>7. Proprietate intelectuală</h2>
            <p>
              Serviciul și conținutul său original, caracteristicile și funcționalitatea sunt și vor rămâne proprietatea
              exclusivă a Companiei și a licențiatorilor săi. Serviciul este protejat de drepturi de autor, mărci
              comerciale și alte legi.
            </p>

            <h2>8. Modificări ale Termenilor</h2>
            <p>
              Ne rezervăm dreptul, la discreția noastră, de a modifica sau înlocui acești Termeni în orice moment. Dacă
              o revizuire este semnificativă, vom încerca să oferim un preaviz de cel puțin 30 de zile înainte ca noii
              termeni să intre în vigoare.
            </p>

            <h2>9. Legea aplicabilă</h2>
            <p>
              Acești Termeni vor fi guvernați și interpretați în conformitate cu legile României, fără a ține cont de
              conflictele de prevederi legale.
            </p>

            <h2>10. Contact</h2>
            <p>Dacă aveți întrebări despre acești Termeni, vă rugăm să ne contactați:</p>
            <ul>
                              <li>Email: contact.parcareaeroport@gmail.com</li>
                              <li>Telefon: +40 734 292 818</li>
                              <li>Adresă: Str. Calea Bucureştilor, Nr.303A1, Otopeni, Ilfov</li>
            </ul>
          </div>
        </div>
      </div>
      {/* <Footer /> */}
    </main>
  )
}
