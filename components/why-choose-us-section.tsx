import { Shield, CheckCircle, Car, Zap, Coffee, Armchair } from "lucide-react"

export default function WhyChooseUsSection() {
  return (
    <section className="py-12 md:py-16 bg-white">
      <div className="container mx-auto px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-12 md:mb-16 text-center text-primary">
            De ce să alegi parcarea noastră?
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-0 relative">
            {/* Vertical dividing lines - only visible on desktop */}
            <div className="hidden md:block absolute left-1/3 top-0 bottom-0 w-px bg-gray-200"></div>
            <div className="hidden md:block absolute left-2/3 top-0 bottom-0 w-px bg-gray-200"></div>

            {/* Feature 1 - Control total și eficiență maximă */}
            <div className="text-center px-4 md:px-8 group">
              <div className="relative mx-auto mb-6 w-40 h-40 rounded-full bg-gradient-to-br from-blue-50 to-indigo-50 group-hover:from-blue-100 group-hover:to-indigo-100 transition-all duration-500 group-hover:scale-105">
                <div className="absolute inset-0 flex items-center justify-center">
                  {/* 3D Icon Container */}
                  <div className="relative transform group-hover:scale-110 transition-transform duration-300">
                    <Shield 
                      className="w-16 h-16 text-blue-600 drop-shadow-lg relative z-10 group-hover:text-indigo-700 transition-colors duration-300" 
                      strokeWidth={1.5}
                    />
                    <CheckCircle 
                      className="w-8 h-8 text-green-500 absolute -bottom-2 -right-2 drop-shadow-md group-hover:text-green-400 group-hover:scale-110 transition-all duration-300" 
                      strokeWidth={2}
                    />
                  </div>
                </div>
                <div className="absolute -top-2 -right-2 w-8 h-8 flex items-center justify-center">
                  <div className="w-6 h-6 bg-yellow-300 rounded-full transform rotate-45 group-hover:rotate-90 transition-transform duration-300"></div>
                  <div className="absolute w-4 h-4 bg-yellow-400 rounded-full group-hover:scale-110 transition-transform duration-300"></div>
                </div>
              </div>
              <h3 className="text-xl font-bold mb-3 group-hover:text-indigo-700 transition-colors duration-300">Control total și eficiență maximă</h3>
              <p className="text-gray-600 leading-relaxed">
                Alege parcarea noastră și economisești nu doar bani, ci și timp prețios și energie. Începi și termini călătoria relaxat, fără surprize neplăcute, cu un serviciu premium la un preț corect și transparent.
              </p>
            </div>

            {/* Feature 2 - Acces rapid în parcare */}
            <div className="text-center px-4 md:px-8 group">
              <div className="relative mx-auto mb-6 w-40 h-40 rounded-full bg-gradient-to-br from-emerald-50 to-teal-50 group-hover:from-emerald-100 group-hover:to-teal-100 transition-all duration-500 group-hover:scale-105">
                <div className="absolute inset-0 flex items-center justify-center">
                  {/* 3D Icon Container */}
                  <div className="relative transform group-hover:scale-110 transition-transform duration-300">
                    <Car 
                      className="w-16 h-16 text-emerald-600 drop-shadow-lg relative z-10 group-hover:text-teal-700 transition-colors duration-300" 
                      strokeWidth={1.5}
                    />
                    <Zap 
                      className="w-8 h-8 text-yellow-500 absolute -top-2 -right-2 drop-shadow-md group-hover:text-yellow-400 group-hover:animate-pulse transition-all duration-300" 
                      strokeWidth={2}
                    />
                  </div>
                </div>
                <div className="absolute -top-2 -right-2 w-8 h-8 flex items-center justify-center">
                  <div className="w-6 h-6 bg-yellow-300 rounded-full transform rotate-45 group-hover:rotate-90 transition-transform duration-300"></div>
                  <div className="absolute w-4 h-4 bg-yellow-400 rounded-full group-hover:scale-110 transition-transform duration-300"></div>
                </div>
              </div>
              <h3 className="text-xl font-bold mb-3 group-hover:text-teal-700 transition-colors duration-300">Acces rapid în parcare</h3>
              <p className="text-gray-600 leading-relaxed">
                Accesul în parcare se poate face prin citirea automată a numărului de înmatriculare sau codul QR generat pentru tine. În plus, ai parte de un tarif avantajos pentru parcare lângă aeroportul Otopeni.
              </p>
            </div>

            {/* Feature 3 - Zonă de relaxare */}
            <div className="text-center px-4 md:px-8 group">
              <div className="relative mx-auto mb-6 w-40 h-40 rounded-full bg-gradient-to-br from-amber-50 to-orange-50 group-hover:from-amber-100 group-hover:to-orange-100 transition-all duration-500 group-hover:scale-105">
                <div className="absolute inset-0 flex items-center justify-center">
                  {/* 3D Icon Container */}
                  <div className="relative transform group-hover:scale-110 transition-transform duration-300">
                    <Armchair 
                      className="w-16 h-16 text-amber-600 drop-shadow-lg relative z-10 group-hover:text-orange-700 transition-colors duration-300" 
                      strokeWidth={1.5}
                    />
                    <Coffee 
                      className="w-8 h-8 text-amber-700 absolute -bottom-2 -right-2 drop-shadow-md group-hover:text-amber-800 group-hover:animate-bounce transition-all duration-300" 
                      strokeWidth={2}
                    />
                  </div>
                </div>
                <div className="absolute -top-2 -right-2 w-8 h-8 flex items-center justify-center">
                  <div className="w-6 h-6 bg-yellow-300 rounded-full transform rotate-45 group-hover:rotate-90 transition-transform duration-300"></div>
                  <div className="absolute w-4 h-4 bg-yellow-400 rounded-full group-hover:scale-110 transition-transform duration-300"></div>
                </div>
              </div>
              <h3 className="text-xl font-bold mb-3 group-hover:text-orange-700 transition-colors duration-300">Zonă de relaxare</h3>
              <p className="text-gray-600 leading-relaxed">
                Așteaptă transferul sau relaxează-te după un zbor lung în zona noastră special amenajată. Savurează o cafea aromată, un ceai sau răcorește-te cu o apă plată și mici snack-uri pentru un plus de energie.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
