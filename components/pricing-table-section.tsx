/* eslint-disable react-hooks/exhaustive-deps */
"use client"

import { useState, useEffect, useMemo } from "react"
import Link from "next/link"
import { CalendarDays, ChevronRight, Loader2 } from "lucide-react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { db } from "@/lib/firebase"
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  type DocumentData,
} from "firebase/firestore"
import { useToast } from "@/components/ui/use-toast"

/* ---------- types & helpers ---------- */
interface PriceData extends DocumentData {
  days: number
  standardPrice: number
  discountPercentage: number
  reducereAplicata?: number // Noua structură din backend
}

const initialPricePlaceholder = "N/A"
const formatPrice = (v: number, withStar = false) =>
  `${v.toFixed(2)} RON${withStar ? "*" : ""}`

/* ---------- component ---------- */
export default function PricingTableSection() {
  const { toast } = useToast()

  /* ----------- state ----------- */
  const [initialLoading, setInitialLoading] = useState(true) // doar prima încărcare
  const [selectedDayMobile, setSelectedDayMobile] =
    useState<string | undefined>(undefined)

  const [dayKeys, setDayKeys] = useState<string[]>([]) // ex. ["1","2","3"]
  const [pricesReduced, setPricesReduced] = useState<Record<string, string>>({})
  const [pricesStandard, setPricesStandard] = useState<Record<string, string>>({})

  /* ----------- Firestore listener (o singură dată) ----------- */
  useEffect(() => {
    const q = query(collection(db, "prices"), orderBy("days", "asc"))

    const unsub = onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => {
        const reduced: Record<string, string> = {}
        const standard: Record<string, string> = {}
        const keys: string[] = []
        
        // Sortează și limitează la primele 8 zile
        const sortedPrices = snap.docs
          .map(d => ({ id: d.id, ...d.data() as PriceData }))
          .sort((a, b) => a.days - b.days)
          .slice(0, 8) // Limitează la primele 8 zile

        sortedPrices.forEach((p) => {
          const k = p.days.toString()
          keys.push(k)

          standard[k] = formatPrice(p.standardPrice)
          
          // Folosește reducereAplicata dacă există, altfel calculează din procent
          const reduction = p.reducereAplicata ?? (p.standardPrice * p.discountPercentage / 100)
          const final = p.standardPrice - reduction
          const hasDiscount = reduction > 0
          
          reduced[k] = formatPrice(final, hasDiscount)
        })

        setDayKeys(keys)
        setPricesReduced(reduced)
        setPricesStandard(standard)
        setSelectedDayMobile((old) => old ?? keys[0]) // setează primul tab
        setInitialLoading(false)
      },
      (err) => {
        console.error("Firestore pricing error:", err)
        toast({
          title: "Eroare la preluarea prețurilor",
          description: "Nu s-au putut încărca tarifele.",
          variant: "destructive",
        })
        setInitialLoading(false)
      },
    )

    return unsub
  }, [])

  /* ----------- split zile în rânduri de max 4 pentru mobile ----------- */
  const rows = useMemo(() => {
    const tmp = [...dayKeys]
    const out: string[][] = []
    while (tmp.length) out.push(tmp.splice(0, 4))
    return out
  }, [dayKeys])

  const reducedReady = !!pricesReduced[selectedDayMobile!]
  const standardReady = !!pricesStandard[selectedDayMobile!]

  /* ======================== JSX ======================== */
  return (
    <section className="py-12 md:py-16 bg-gray-50">
      <div className="container mx-auto px-4">
        {/* ---------- HEADER ---------- */}
        <div className="text-center mb-8 md:mb-12">
          <h2 className="text-2xl sm:text-3xl font-bold mb-3 text-waze-blue">
            Parcare Otopeni preț avantajos
          </h2>
          <p className="text-lg sm:text-xl mb-4 sm:mb-5">
            Lângă aeroportul Henri Coandă București
          </p>
          <div className="flex flex-wrap justify-center gap-2 sm:gap-3 text-gray-700 text-xs sm:text-sm font-semibold mb-4">
            <span className="bg-white px-2 sm:px-3 py-1 rounded-full shadow-sm">Parcare ASFALTATĂ</span>
            <span className="bg-white px-2 sm:px-3 py-1 rounded-full shadow-sm">Rezervare rapidă</span>
            <span className="bg-white px-2 sm:px-3 py-1 rounded-full shadow-sm">Securitate NON-STOP</span>
            <span className="bg-white px-2 sm:px-3 py-1 rounded-full shadow-sm">Proximitate aeroport</span>
            <span className="bg-white px-2 sm:px-3 py-1 rounded-full shadow-sm">Transfer gratuit</span>
          </div>
          <div className="text-base sm:text-lg mb-2">
            Profită de promoțiile noastre și rezervă acum!<br />
         
          </div>
        </div>

        <div className="max-w-5xl mx-auto bg-white rounded-2xl shadow-xl overflow-hidden">
          {/* ---------- BANNER ---------- */}
          <div className="gradient-bg text-black p-4 sm:p-5 text-center">
            <p className="text-base sm:text-xl font-bold">
              Tarife&nbsp;Parcare&nbsp;Otopeni
            </p>
            <p className="text-xs sm:text-sm mt-1 opacity-90">
              * Prețurile promoționale sunt valabile pe perioada afișării pe site
            </p>
          </div>

          {/* ======================= MOBILE ======================= */}
          <div className="p-4 sm:p-6 md:hidden">
           
            {dayKeys.length > 0 && (
              <Tabs
                value={selectedDayMobile}
                onValueChange={setSelectedDayMobile}
                className="w-full"
              >
                {rows.map((row, idx) => (
                  <TabsList
                    key={`row-${idx}`}
                    className="grid grid-cols-4 mb-6"
                  >
                    {row.map((day) => (
                      <TabsTrigger
                        key={`mob-${day}`}
                        value={day}
                        className="text-xs sm:text-sm"
                      >
                        <div className="flex flex-col items-center">
                          <CalendarDays className="h-4 w-4 mb-1 text-primary" />
                          <span>
                            {day} {day === "1" ? "ZI" : "ZILE"}
                          </span>
                        </div>
                      </TabsTrigger>
                    ))}
                    {/* umple col-urile rămase pt aliniere */}
                    {Array.from({ length: 4 - row.length }).map((_, i) => (
                      <div key={`empty-${idx}-${i}`} />
                    ))}
                  </TabsList>
                ))}

                <TabsContent value={selectedDayMobile!} className="mt-0">
                  <div className="space-y-4">
                    {/* REDUS & STANDARD cards */}
                    {[
                      {
                        label: "REDUS",
                        map: pricesReduced,
                        bg: "primary/10",
                        strike: false,
                        colorSpinner: "primary",
                      },
                      // {
                      //   label: "STANDARD",
                      //   map: pricesStandard,
                      //   bg: "gray-100",
                      //   strike: true,
                      //   colorSpinner: "gray-400",
                      // },
                    ].map(
                      (
                        { label, map, bg, strike, colorSpinner },
                        idx /* index pentru key */,
                      ) => {
                        const ready = !!map[selectedDayMobile!]
                        return (
                          <div
                            key={idx}
                            className={`flex items-center justify-between bg-${bg} p-4 rounded-xl`}
                          >
                            <span
                              className={`font-bold ${
                                label === "REDUS"
                                  ? "text-primary"
                                  : "text-gray-700"
                              }`}
                            >
                              {label}
                            </span>

                            {!ready ? (
                              <Loader2
                                className={`h-5 w-5 animate-spin text-${colorSpinner}`}
                              />
                            ) : (
                              <span
                                className={`font-medium text-lg ${
                                  strike ? "line-through text-gray-400" : ""
                                }`}
                              >
                                {map[selectedDayMobile!] ??
                                  initialPricePlaceholder}
                              </span>
                            )}
                          </div>
                        )
                      },
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            )}

            {/* <p className="mt-6 text-xs sm:text-sm text-gray-600 bg-gray-50 p-4 rounded-xl">
              * TVA&nbsp;19&nbsp;%. Reducerea de 30&nbsp;% se aplică începând cu
              a&nbsp;2-a zi de staționare.{" "}
              <Link
                href="/#rezerva-formular"
                className="text-primary hover:underline font-medium"
              >
                Vezi detalii și rezervă
              </Link>
            </p> */}

            <div className="mt-6 text-center">
              {/* Buton Principal - Fundal roz + Text alb */}
              <Link
                href="/#rezerva-formular"
                className="inline-flex items-center gap-2 bg-[#ee7f1a] hover:bg-[#d67016] text-white px-8 py-4 rounded-md transition-all duration-200 font-medium shadow-md hover:shadow-lg hover:scale-105"
              >
                <span>Rezervă acum</span>
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </div>

          {/* ======================= DESKTOP ======================= */}
          <div className="hidden md:block p-8">
            

            {/* HEAD ROW */}
            <div
              className="grid gap-3 mb-6"
              style={{
                gridTemplateColumns: `120px repeat(${dayKeys.length}, minmax(80px,1fr))`,
              }}
            >
              <div />
              {dayKeys.map((d) => {
                const num = Number(d)
                return (
                  <div
                    key={`h-${d}`}
                    className="flex flex-col items-center justify-center p-3 bg-gray-50 rounded-xl shadow-sm"
                  >
                    <CalendarDays className="h-5 w-5 text-primary mb-1" />
                    <span className="text-sm font-medium">
                      {num} {num === 1 ? "ZI" : "ZILE"}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* REDUS ROW */}
            <div
              className="grid gap-3 mb-6"
              style={{
                gridTemplateColumns: `120px repeat(${dayKeys.length}, minmax(80px,1fr))`,
              }}
            >
              <div className="flex items-center justify-center bg-primary/10 p-4 rounded-xl">
                <span className="font-bold text-primary">TARIFE</span>
              </div>
              {dayKeys.map((d) => (
                <div
                  key={`r-${d}`}
                  className="flex items-center justify-center border border-primary/20 p-4 rounded-xl hover:border-primary/50 transition-colors"
                >
                  {pricesReduced[d] ? (
                    <span className="font-medium">{pricesReduced[d]}</span>
                  ) : (
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  )}
                </div>
              ))}
            </div>

            {/* STANDARD ROW */}
            {/* <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: `120px repeat(${dayKeys.length}, minmax(80px,1fr))`,
              }}
            >
              <div className="flex items-center justify-center bg-gray-100 p-4 rounded-xl">
                <span className="font-bold">STANDARD</span>
              </div>
              {dayKeys.map((d) => (
                <div
                  key={`s-${d}`}
                  className="flex items-center justify-center border border-gray-200 p-4 rounded-xl"
                >
                  {pricesStandard[d] ? (
                    <span className="font-medium line-through text-gray-400">
                      {pricesStandard[d]}
                    </span>
                  ) : (
                    <Loader2 className="h-5 w-5 animate-spin text-gray-700" />
                  )}
                </div>
              ))}
            </div> */}
          </div>

          {/* CTA la finalul containerului alb */}
          <div className="w-full flex flex-col items-center gap-2 py-8">
            <p className="text-sm text-gray-600 text-center">
              Afișând primele 8 zile. Pentru tarife complete:
            </p>
            {/* Buton Secundar - Fundal alb + Border & Text roz */}
            <Link
              href="/tarife"
              className="inline-flex items-center gap-2 bg-white hover:bg-[#ee7f1a]/5 text-[#ee7f1a] hover:text-[#ee7f1a] border-2 border-[#ee7f1a] hover:border-[#d67016] px-8 py-4 rounded-md transition-all duration-200 font-medium shadow-sm hover:shadow-md"
            >
              Vezi toate tarifele (30+ zile)
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
