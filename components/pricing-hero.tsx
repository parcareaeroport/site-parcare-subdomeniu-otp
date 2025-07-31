import Image from "next/image"

export default function PricingHero() {
  return (
    <section className="py-16 md:py-24 bg-white">
      <div className="container mx-auto px-4">
        <div className="max-w-5xl mx-auto text-center mb-16">
          <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-3 text-primary">Tarife Parcare Otopeni- OTP Parking</h1>
          <p className="text-xl md:text-2xl lg:text-3xl text-gray-700 max-w-3xl mx-auto">
            Prețuri transparente și competitive pentru parcarea ta de lângă aeroport.
          </p>
        </div>

        <div className="relative max-w-6xl mx-auto">
          {/* Main layout with image in center and stats around it */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-32 lg:gap-40 items-center">
            {/* Left Column Stats */}
            <div className="flex flex-col space-y-12 md:space-y-24">
              {/* Top Left Stat */}
              <div className="text-center md:text-right relative">
                <div className="hidden md:block absolute bottom-[calc(19%+0.75rem)] right-0 w-24 lg:w-32 h-0.5 bg-orange-500 transform translate-x-full">
                  <div className="absolute right-0 top-1/2 w-4 h-4 bg-orange-500 rounded-full transform -translate-y-1/2"></div>
                </div>
                <h3 className="text-2xl md:text-3xl font-bold text-waze-blue">49,98 LEI</h3>
                <p className="text-gray-600">preț pentru o zi de parcare</p>
              </div>

              {/* Bottom Left Stat */}
              <div className="text-center md:text-right relative">
                <div className="hidden md:block absolute bottom-[calc(19%+0.75rem)] right-0 w-24 lg:w-32 h-0.5 bg-orange-500 transform translate-x-full">
                  <div className="absolute right-0 top-1/2 w-4 h-4 bg-orange-500 rounded-full transform -translate-y-1/2"></div>
                </div>
                <h3 className="text-2xl md:text-3xl font-bold text-waze-blue">500m</h3>
                <p className="text-gray-600">distanță față de aeroport</p>
              </div>
            </div>

            {/* Center Column - Image */}
            <div className="flex justify-center mt-8 md:mt-12">
              <div className="relative z-10 w-72 h-72 md:w-80 md:h-80 aspect-square rounded-full overflow-hidden border-4 border-white shadow-xl shrink-0">
                <Image
                  src="/Tarife Parcare Otopeni - OTP Parking.jpg"
                  alt="Parcare Otopeni"
                  fill
                  className="object-cover"
                  style={{ objectPosition: 'center 25%' }}
                />
              </div>
            </div>

            {/* Right Column Stats */}
            <div className="flex flex-col space-y-12 md:space-y-24">
              {/* Top Right Stat */}
              <div className="text-center md:text-left relative">
                <div className="hidden md:block absolute bottom-[calc(19%+0.75rem)] left-0 w-24 lg:w-32 h-0.5 bg-orange-500 transform -translate-x-full">
                  <div className="absolute left-0 top-1/2 w-4 h-4 bg-orange-500 rounded-full transform -translate-y-1/2"></div>
                </div>
                <h3 className="text-2xl md:text-3xl font-bold text-waze-blue">24/7</h3>
                <p className="text-gray-600">supraveghere video și pază</p>
              </div>

              {/* Bottom Right Stat */}
              <div className="text-center md:text-left relative">
                <div className="hidden md:block absolute bottom-[calc(19%+0.75rem)] left-0 w-24 lg:w-32 h-0.5 bg-orange-500 transform -translate-x-full">
                  <div className="absolute left-0 top-1/2 w-4 h-4 bg-orange-500 rounded-full transform -translate-y-1/2"></div>
                </div>
                <h3 className="text-2xl md:text-3xl font-bold text-waze-blue">Parcare Otopeni</h3>
                <p className="text-gray-600">Rezervări online</p>
              </div>
            </div>
          </div>

          {/* Mobile dots for visual connection (visible only on mobile) */}
          <div className="flex justify-center space-x-2 mt-8 md:hidden">
                  <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
      <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
      <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
      <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
          </div>

          {/* Additional features below the image */}
          <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
            <div className="bg-gray-50 p-6 rounded-xl shadow-sm">
              <h3 className="font-bold text-lg mb-2 text-waze-blue">Parcare asfaltată</h3>
              <p className="text-gray-600 text-sm">Suprafață asfaltată și marcată pentru confort maxim</p>
            </div>
            <div className="bg-gray-50 p-6 rounded-xl shadow-sm">
              <h3 className="font-bold text-lg mb-2 text-waze-blue">Transfer gratuit</h3>
              <p className="text-gray-600 text-sm">Transport gratuit dus-întors la terminal</p>
            </div>
            <div className="bg-gray-50 p-6 rounded-xl shadow-sm">
              <h3 className="font-bold text-lg mb-2 text-waze-blue">Rezervare online</h3>
              <p className="text-gray-600 text-sm">Sistem simplu de rezervare cu confirmare instantă</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
