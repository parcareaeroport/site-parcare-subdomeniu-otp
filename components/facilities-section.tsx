import { Plane, MapPin, Palmtree, Luggage, Laptop, TrendingUp, Music, Sparkles } from "lucide-react"

export default function FacilitiesSection() {
  return (
    <section className="py-12 md:py-16 bg-primary/5">
      <div className="container mx-auto px-4 md:px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold mb-8 md:mb-10 text-center text-primary">
            Mergi liniștit în vacanță alături de cei drag sau în călătoria ta de afaceri, noi avem grijă de mașina ta!
          </h2>
          <p className="text-lg sm:text-xl text-center text-gray-700 mb-10 md:mb-12 max-w-4xl mx-auto">
            Cauți cea mai bună parcare privată aeroport Otopeni? Sau parcare long term Otopeni? Sau chiar o parcare Otopeni ieftină? Suntem aici pentru tine!
          </p>

          <div className="relative">
            {/* Horizontal connecting line - hidden on mobile, visible on desktop */}
            <div className="absolute top-1/2 left-0 right-0 h-1 bg-gradient-to-r from-yellow-400 via-yellow-500 to-yellow-400 hidden md:block shadow-lg"></div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8 relative">
              {/* Facility 1 - City break */}
              <div className="bg-white rounded-2xl shadow-lg overflow-hidden relative z-10 group hover:shadow-2xl hover:-translate-y-2 transition-all duration-500 hover:bg-gradient-to-br hover:from-blue-50 hover:to-indigo-50">
                <div className="p-6 md:p-8 flex flex-col items-center">
                  <div className="mb-4 md:mb-6 relative">
                    {/* 3D Icon Container */}
                    <div className="w-12 h-12 sm:w-16 sm:h-16 md:w-20 md:h-20 flex items-center justify-center relative transform group-hover:scale-110 transition-transform duration-300">
                      <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl opacity-20 group-hover:opacity-30 transition-opacity duration-300 shadow-inner"></div>
                      <MapPin 
                        className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 text-blue-600 drop-shadow-lg relative z-10 group-hover:text-indigo-700 transition-colors duration-300" 
                        strokeWidth={1.5}
                      />
                      <Plane 
                        className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 text-yellow-500 absolute -top-1 -right-1 rotate-45 drop-shadow-md group-hover:rotate-90 group-hover:text-yellow-400 transition-all duration-500" 
                        strokeWidth={2}
                      />
                    </div>
                  </div>
                  <h3 className="text-base sm:text-lg md:text-xl font-bold text-center text-waze-blue hover:text-waze-blue/80 transition-colors duration-300">City break</h3>
                </div>
                <div className="absolute right-0 top-1/2 transform -translate-y-1/2 w-2 h-16 bg-gradient-to-b from-yellow-400 to-yellow-500 hidden md:block shadow-lg"></div>
              </div>

              {/* Facility 2 - Sejur prelungit */}
              <div className="bg-white rounded-2xl shadow-lg overflow-hidden relative z-10 group hover:shadow-2xl hover:-translate-y-2 transition-all duration-500 hover:bg-gradient-to-br hover:from-green-50 hover:to-emerald-50">
                <div className="p-6 md:p-8 flex flex-col items-center">
                  <div className="mb-4 md:mb-6 relative">
                    {/* 3D Icon Container */}
                    <div className="w-12 h-12 sm:w-16 sm:h-16 md:w-20 md:h-20 flex items-center justify-center relative transform group-hover:scale-110 transition-transform duration-300">
                      <div className="absolute inset-0 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl opacity-20 group-hover:opacity-30 transition-opacity duration-300 shadow-inner"></div>
                      <Palmtree 
                        className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 text-green-600 drop-shadow-lg relative z-10 group-hover:text-emerald-700 transition-colors duration-300 group-hover:animate-pulse" 
                        strokeWidth={1.5}
                      />
                      <Luggage 
                        className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 text-amber-600 absolute -bottom-1 -right-1 drop-shadow-md group-hover:text-amber-700 transition-colors duration-300" 
                        strokeWidth={2}
                      />
                    </div>
                  </div>
                  <h3 className="text-base sm:text-lg md:text-xl font-bold text-center text-waze-blue hover:text-waze-blue/80 transition-colors duration-300">Sejur prelungit</h3>
                </div>
                <div className="absolute right-0 top-1/2 transform -translate-y-1/2 w-2 h-16 bg-gradient-to-b from-yellow-400 to-yellow-500 hidden md:block shadow-lg"></div>
              </div>

              {/* Facility 3 - Business trip */}
              <div className="bg-white rounded-2xl shadow-lg overflow-hidden relative z-10 group hover:shadow-2xl hover:-translate-y-2 transition-all duration-500 hover:bg-gradient-to-br hover:from-slate-50 hover:to-blue-50">
                <div className="p-6 md:p-8 flex flex-col items-center">
                  <div className="mb-4 md:mb-6 relative">
                    {/* 3D Icon Container */}
                    <div className="w-12 h-12 sm:w-16 sm:h-16 md:w-20 md:h-20 flex items-center justify-center relative transform group-hover:scale-110 transition-transform duration-300">
                      <div className="absolute inset-0 bg-gradient-to-br from-slate-500 to-blue-600 rounded-xl opacity-20 group-hover:opacity-30 transition-opacity duration-300 shadow-inner"></div>
                      <Laptop 
                        className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 text-slate-700 drop-shadow-lg relative z-10 group-hover:text-blue-700 transition-colors duration-300" 
                        strokeWidth={1.5}
                      />
                      <TrendingUp 
                        className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 text-green-500 absolute -top-1 -right-1 drop-shadow-md group-hover:text-green-400 group-hover:scale-110 transition-all duration-300" 
                        strokeWidth={2}
                      />
                    </div>
                  </div>
                  <h3 className="text-base sm:text-lg md:text-xl font-bold text-center text-waze-blue hover:text-waze-blue/80 transition-colors duration-300">Business trip</h3>
                </div>
                <div className="absolute right-0 top-1/2 transform -translate-y-1/2 w-2 h-16 bg-gradient-to-b from-yellow-400 to-yellow-500 hidden md:block shadow-lg"></div>
              </div>

              {/* Facility 4 - Călătorii pentru evenimente */}
              <div className="bg-white rounded-2xl shadow-lg overflow-hidden relative z-10 group hover:shadow-2xl hover:-translate-y-2 transition-all duration-500 hover:bg-gradient-to-br hover:from-purple-50 hover:to-orange-50">
                <div className="p-6 md:p-8 flex flex-col items-center">
                  <div className="mb-4 md:mb-6 relative">
                    {/* 3D Icon Container */}
                    <div className="w-12 h-12 sm:w-16 sm:h-16 md:w-20 md:h-20 flex items-center justify-center relative transform group-hover:scale-110 transition-transform duration-300">
                      <div className="absolute inset-0 bg-gradient-to-br from-purple-500 to-orange-600 rounded-xl opacity-20 group-hover:opacity-30 transition-opacity duration-300 shadow-inner"></div>
                      <Music 
                        className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 text-purple-600 drop-shadow-lg relative z-10 group-hover:text-orange-700 transition-colors duration-300 group-hover:animate-bounce" 
                        strokeWidth={1.5}
                      />
                      <Sparkles 
                        className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 text-yellow-500 absolute -top-1 -right-1 drop-shadow-md group-hover:text-orange-400 group-hover:animate-spin transition-all duration-300" 
                        strokeWidth={2}
                      />
                    </div>
                  </div>
                  <h3 className="text-base sm:text-lg md:text-xl font-bold text-center text-waze-blue hover:text-waze-blue/80 transition-colors duration-300">Călătorii pentru evenimente</h3>
                </div>
                <div className="absolute right-0 top-1/2 transform -translate-y-1/2 w-2 h-16 bg-gradient-to-b from-yellow-400 to-yellow-500 hidden md:block shadow-lg"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
