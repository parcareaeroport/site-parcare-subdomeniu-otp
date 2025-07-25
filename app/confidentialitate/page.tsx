import type { Metadata } from "next"
import Header from "@/components/header"
import Footer from "@/components/footer"

export const metadata: Metadata = {
  title: "Politica de Confidențialitate | Parcare-Aeroport Otopeni",
  description: "Informații despre modul în care colectăm, utilizăm și protejăm datele dvs. personale.",
  keywords: ["politica confidentialitate", "protectia datelor", "gdpr parcare otopeni"],
  alternates: {
    canonical: "/confidentialitate",
  },
}

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-gray-50">
      {/* <Header /> */}
      <div className="container mx-auto px-4 py-12 md:py-16">
        <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8 mb-8">
          <h1 className="text-2xl md:text-3xl font-bold mb-6 text-center">Politica de Confidențialitate</h1>

          <div className="prose prose-sm sm:prose max-w-none">
            <p>Ultima actualizare: {new Date().toLocaleDateString("ro-RO")}</p>

            <p>
              Această Politică de Confidențialitate descrie modul în care Parcare-Aeroport SRL ("noi", "nouă" sau
              "nostru") colectează, utilizează și divulgă informațiile dvs. atunci când utilizați serviciul nostru de
              parcare și site-ul web parcare-aeroport.ro ("Serviciul").
            </p>

            <h2>1. Informațiile pe care le colectăm</h2>

            <h3>1.1. Informații personale</h3>
            <p>Când efectuați o rezervare sau creați un cont, putem colecta următoarele informații:</p>
            <ul>
              <li>Nume și prenume</li>
              <li>Adresă de email</li>
              <li>Număr de telefon</li>
              <li>Adresă de facturare</li>
              <li>Număr de înmatriculare vehicul</li>
              <li>Informații de plată (procesate securizat prin procesatorii noștri de plăți)</li>
              <li>Informații despre companie (pentru facturare)</li>
            </ul>

            <h3>1.2. Informații de utilizare</h3>
            <p>De asemenea, putem colecta informații despre modul în care accesați și utilizați Serviciul nostru:</p>
            <ul>
              <li>Adresa IP</li>
              <li>Tipul browserului</li>
              <li>Paginile vizitate</li>
              <li>Ora și data vizitei</li>
              <li>Timpul petrecut pe pagini</li>
              <li>Identificatori unici de dispozitiv</li>
            </ul>

            <h2>2. Cum utilizăm informațiile dvs.</h2>
            <p>Utilizăm informațiile colectate pentru:</p>
            <ul>
              <li>Procesarea și gestionarea rezervărilor dvs.</li>
              <li>Procesarea plăților</li>
              <li>Comunicarea cu dvs. despre rezervări, modificări sau anulări</li>
              <li>Trimiterea de informații despre serviciile noastre (dacă v-ați abonat)</li>
              <li>Îmbunătățirea și personalizarea experienței dvs. pe site</li>
              <li>Analizarea utilizării site-ului pentru a îmbunătăți serviciile noastre</li>
              <li>Respectarea obligațiilor legale</li>
            </ul>

            <h2>3. Partajarea informațiilor</h2>
            <p>Nu vindem informațiile dvs. personale către terți. Putem partaja informațiile dvs. cu:</p>
            <ul>
              <li>Procesatori de plăți pentru a procesa plățile dvs.</li>
              <li>Furnizori de servicii care ne ajută să operăm afacerea (hosting, email, etc.)</li>
              <li>Autorități publice când legea ne obligă</li>
            </ul>

            <h2>4. Cookie-uri și tehnologii similare</h2>
            <p>
              Utilizăm cookie-uri și tehnologii similare pentru a îmbunătăți experiența dvs. pe site-ul nostru. Acestea
              ne ajută să:
            </p>
            <ul>
              <li>Menținem sesiunea dvs. activă</li>
              <li>Memorăm preferințele dvs.</li>
              <li>Analizăm traficul și comportamentul utilizatorilor</li>
              <li>Îmbunătățim securitatea site-ului</li>
            </ul>
            <p>
              Puteți configura browserul dvs. să refuze toate cookie-urile sau să vă alerteze când sunt trimise
              cookie-uri. Cu toate acestea, unele funcții ale site-ului nostru pot să nu funcționeze corect fără
              cookie-uri.
            </p>

            <h2>5. Securitatea datelor</h2>
            <p>
              Securitatea datelor dvs. este importantă pentru noi. Am implementat măsuri tehnice și organizaționale
              adecvate pentru a proteja informațiile dvs. personale împotriva pierderii, utilizării neautorizate sau
              modificării. Cu toate acestea, nicio metodă de transmitere pe internet sau metodă de stocare electronică
              nu este 100% sigură.
            </p>

            <h2>6. Drepturile dvs.</h2>
            <p>În conformitate cu Regulamentul General privind Protecția Datelor (GDPR), aveți următoarele drepturi:</p>
            <ul>
              <li>Dreptul de acces la datele dvs. personale</li>
              <li>Dreptul la rectificarea datelor inexacte</li>
              <li>Dreptul la ștergerea datelor ("dreptul de a fi uitat")</li>
              <li>Dreptul la restricționarea prelucrării</li>
              <li>Dreptul la portabilitatea datelor</li>
              <li>Dreptul de a obiecta la prelucrarea datelor</li>
              <li>Dreptul de a nu face obiectul unei decizii bazate exclusiv pe prelucrarea automată</li>
            </ul>
            <p>
              Pentru a vă exercita aceste drepturi, vă rugăm să ne contactați la datele furnizate în secțiunea
              "Contact".
            </p>

            <h2>7. Perioada de păstrare a datelor</h2>
            <p>
              Păstrăm datele dvs. personale atât timp cât este necesar pentru a îndeplini scopurile pentru care le-am
              colectat, inclusiv pentru a satisface cerințele legale, contabile sau de raportare.
            </p>

            <h2>8. Modificări ale acestei politici</h2>
            <p>
              Putem actualiza Politica noastră de Confidențialitate din când în când. Vă vom notifica despre orice
              modificări prin postarea noii Politici de Confidențialitate pe această pagină și, dacă modificările sunt
              semnificative, vom trimite o notificare prin email.
            </p>

            <h2>9. Contact</h2>
            <p>Dacă aveți întrebări despre această Politică de Confidențialitate, vă rugăm să ne contactați:</p>
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
