"use client"

import { useEffect, useState, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { CheckCircle, XCircle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import Header from "@/components/header"
import Footer from "@/components/footer"
import CheckoutSteps from "@/components/checkout-steps"
import { getStripe } from "@/lib/stripe" // Pentru a prelua instanța Stripe.js
import { collection, addDoc, serverTimestamp, query, where, getDocs, doc, updateDoc, increment } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useToast } from "@/components/ui/use-toast"
import { normalizeLicensePlate } from "@/lib/utils"

interface ReservationData {
  licensePlate: string
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  days: number
  price: number
  formattedStartDate: string
  formattedEndDate: string
  clientName?: string // Adăugate din OrderPlacementForm
  clientEmail?: string
  clientPhone?: string
  clientTitle?: string
  apiBookingNumber?: string // De la API-ul de parcare, dacă e cazul
}

function ConfirmationContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const [status, setStatus] = useState<"loading" | "success" | "error" | "requires_action">("loading")
  const [message, setMessage] = useState("Se verifică statusul plății...")
  const [reservationDetails, setReservationDetails] = useState<ReservationData | null>(null)
  const [bookingNumber, setBookingNumber] = useState<string | null>(null) // Numărul de rezervare de la API-ul de parcare

  useEffect(() => {
    const clientSecret = searchParams.get("payment_intent_client_secret")
    const paymentIntentId = searchParams.get("payment_intent")
    const redirectStatus = searchParams.get("redirect_status")

    // Preluăm datele rezervării din sessionStorage - verificăm multiple surse
    let tempReservationData: ReservationData | null = null
    
    // Prima verificare: datele pentru confirmare (folosit pentru teste)
    const storedTestData = sessionStorage.getItem("reservationDataForConfirmation")
    if (storedTestData) {
      tempReservationData = JSON.parse(storedTestData) as ReservationData
      setReservationDetails(tempReservationData)
    } else {
      // A doua verificare: datele comenzii complete (folosit pentru plățile Stripe)
      const storedOrderData = sessionStorage.getItem("completeOrderData")
      if (storedOrderData) {
        const orderData = JSON.parse(storedOrderData)
        // Convertim datele comenzii în format ReservationData
        tempReservationData = {
          licensePlate: normalizeLicensePlate(orderData.reservationData.licensePlate),
          startDate: orderData.reservationData.startDate,
          startTime: orderData.reservationData.startTime,
          endDate: orderData.reservationData.endDate,
          endTime: orderData.reservationData.endTime,
          days: orderData.reservationData.days,
          price: orderData.total,
          formattedStartDate: orderData.reservationData.formattedStartDate,
          formattedEndDate: orderData.reservationData.formattedEndDate,
          clientName: `${orderData.customerInfo.firstName} ${orderData.customerInfo.lastName}`.trim(),
          clientEmail: orderData.customerInfo.email,
          clientPhone: orderData.customerInfo.phone,
        }
        setReservationDetails(tempReservationData)
      } else {
        // A treia verificare: rezultatul rezervării (folosit după plăți Stripe reușite)
        const storedBookingResult = sessionStorage.getItem("bookingResult")
        if (storedBookingResult) {
          const bookingResult = JSON.parse(storedBookingResult)
          // Convertim rezultatul rezervării în format ReservationData
          tempReservationData = {
            licensePlate: normalizeLicensePlate(bookingResult.reservationData.licensePlate),
            startDate: bookingResult.reservationData.startDate,
            startTime: bookingResult.reservationData.startTime,
            endDate: bookingResult.reservationData.endDate,
            endTime: bookingResult.reservationData.endTime,
            days: bookingResult.reservationData.days,
            price: bookingResult.total,
            formattedStartDate: bookingResult.reservationData.formattedStartDate,
            formattedEndDate: bookingResult.reservationData.formattedEndDate,
            clientName: `${bookingResult.customerInfo.firstName} ${bookingResult.customerInfo.lastName}`.trim(),
            clientEmail: bookingResult.customerInfo.email,
            clientPhone: bookingResult.customerInfo.phone,
            apiBookingNumber: bookingResult.bookingNumber,
          }
          setReservationDetails(tempReservationData)
          // Setăm și numărul de rezervare dacă există
          if (bookingResult.bookingNumber) {
            setBookingNumber(bookingResult.bookingNumber)
          }
        } else {
          setMessage("Detaliile rezervării nu au fost găsite. Contactați suportul.")
          setStatus("error")
          return
        }
      }
    }

    // Preluăm numărul de rezervare de la API-ul de parcare, dacă a fost stocat
    const apiBookingNum = sessionStorage.getItem("apiBookingNumber")
    if (apiBookingNum) {
      setBookingNumber(apiBookingNum)
      if (tempReservationData) tempReservationData.apiBookingNumber = apiBookingNum
    }

    // Funcție asincronă pentru verificarea rezervării existente
    const checkExistingBooking = async (paymentIntentId: string, tempReservationData: ReservationData) => {
      try {
        console.log("Checking for existing booking processed by webhook...")
        
        // Verifică dacă există deja o rezervare cu acest paymentIntentId procesată de webhook
        const bookingsCollectionRef = collection(db, "bookings")
        const q = query(bookingsCollectionRef, where("paymentIntentId", "==", paymentIntentId))
        const querySnapshot = await getDocs(q)
        
        if (!querySnapshot.empty) {
          // Rezervarea există deja (salvată de webhook)
          const existingBooking = querySnapshot.docs[0].data()
          console.log("Found existing booking from webhook:", existingBooking.apiBookingNumber)
          
          setStatus("success")
          setMessage("Plata a fost efectuată cu succes! Rezervarea este confirmată. Veți primi un email de confirmare.")
          
          if (existingBooking.apiBookingNumber) {
            setBookingNumber(existingBooking.apiBookingNumber)
          }
          
          // Actualizăm datele de rezervare cu numărul real din API
          if (existingBooking.apiBookingNumber && tempReservationData) {
            tempReservationData.apiBookingNumber = existingBooking.apiBookingNumber
            setReservationDetails(tempReservationData)
          }
          
          toast({ title: "Rezervare confirmată", description: "Rezervarea a fost procesată cu succes de sistemul de plăți." })
          
          // Șterge datele din sessionStorage după procesare
          sessionStorage.removeItem("reservationDataForConfirmation")
          sessionStorage.removeItem("completeOrderData")
          sessionStorage.removeItem("bookingResult")
          sessionStorage.removeItem("apiBookingNumber")
          
          return true // Rezervarea a fost găsită și procesată
        } else {
          console.log("No existing booking found, might be processing delay...")
          // Poate că webhook-ul încă nu a procesat - dăm un timeout scurt și reîncercăm
          setTimeout(() => {
            window.location.reload() // Reîncarcă pagina pentru a verifica din nou
          }, 3000)
          
          setStatus("loading")
          setMessage("Se verifică statusul rezervării... Vă rugăm să așteptați.")
          return false // Rezervarea nu a fost găsită încă
        }
      } catch (firestoreError) {
        console.error("Error checking existing booking:", firestoreError)
        return false // Eroare - continuă cu fluxul normal
      }
    }

    if (!clientSecret || !paymentIntentId) {
      // Verificăm dacă este o confirmare de test (fără plată)
      const testBookingNumber = searchParams.get("bookingNumber") // Trimis de la OrderPlacementForm pentru test
      const testStatus = searchParams.get("status")

      if (testBookingNumber && testStatus === "success_test" && tempReservationData) {
        setStatus("success")
        setMessage(
          `Rezervarea de test (nr. ${testBookingNumber}) a fost înregistrată cu succes! Veți primi un email de confirmare.`,
        )
        setBookingNumber(testBookingNumber) // Setează numărul de rezervare pentru afișare
        return
      }

      // Verificăm dacă este o confirmare cu plată la parcare
      if (testBookingNumber && testStatus === "success_pay_on_site" && tempReservationData) {
        setStatus("success")
        setMessage(
          `Rezervarea a fost înregistrată cu succes! Veți plăti la sosirea în parcare. Veți primi un email de confirmare.`,
        )
        // Pentru pay on site nu setăm bookingNumber pentru că nu avem număr de la Multipark
        // setBookingNumber(testBookingNumber) // Comentat - nu afișăm număr de rezervare pentru pay on site
        return
      }

      // Dacă avem paymentIntentId dar nu clientSecret, verificăm dacă webhook-ul a procesat deja rezervarea
      if (paymentIntentId && !clientSecret && tempReservationData) {
        checkExistingBooking(paymentIntentId, tempReservationData)
        return
      }

      setMessage("Parametrii plății lipsesc. Tranzacție invalidă.")
      setStatus("error")
      return
    }

    const processPayment = async () => {
      const stripe = await getStripe()
      if (!stripe) {
        setMessage("Eroare la inițializarea Stripe.")
        setStatus("error")
        return
      }

      const { error, paymentIntent: retrievedPaymentIntent } = await stripe.retrievePaymentIntent(clientSecret)

      if (error) {
        setMessage(`Eroare la preluarea statusului plății: ${error.message}`)
        setStatus("error")
      } else if (retrievedPaymentIntent) {
        switch (retrievedPaymentIntent.status) {
          case "succeeded":
            setMessage(
              "Plata a fost efectuată cu succes! Rezervarea este confirmată. Veți primi un email de confirmare.",
            )
            setStatus("success")

            // Pentru plățile prin Stripe, webhook-ul ar trebui să se fi ocupat deja de salvarea rezervării
            // Totuși, verificăm și salvăm local dacă este necesar pentru urmărire
            if (tempReservationData) {
              try {
                // Verifică dacă există deja o rezervare cu acest paymentIntentId
                const bookingsCollectionRef = collection(db, "bookings")
                const q = query(bookingsCollectionRef, where("paymentIntentId", "==", paymentIntentId))
                const querySnapshot = await getDocs(q)

                if (querySnapshot.empty) {
                  // Doar dacă nu există deja (webhook-ul ar fi trebuit să o salveze)
                  console.log("Webhook nu a salvat rezervarea, salvez din pagina de confirmare...")
                  await addDoc(bookingsCollectionRef, {
                    ...tempReservationData,
                    paymentIntentId: paymentIntentId,
                    paymentStatus: "paid",
                    status: "confirmed_paid",
                    createdAt: serverTimestamp(),
                    source: "confirmation_page" // Indicăm sursa pentru debug
                  })
                  // OPTIMIZARE: Incrementez contorul de rezervări active
                  const statsDocRef = doc(db, "config", "reservationStats")
                  await updateDoc(statsDocRef, { activeBookingsCount: increment(1) })
                  toast({ title: "Rezervare salvată", description: "Detaliile rezervării au fost salvate în sistem." })
                } else {
                  // Rezervarea există deja (salvată de webhook)
                  const existingBooking = querySnapshot.docs[0].data()
                  if (existingBooking.apiBookingNumber) {
                    setBookingNumber(existingBooking.apiBookingNumber)
                  }
                  toast({ title: "Rezervare confirmată", description: "Rezervarea a fost procesată cu succes." })
                }
                
                // Șterge datele din sessionStorage după procesare
                sessionStorage.removeItem("reservationDataForConfirmation")
                sessionStorage.removeItem("completeOrderData")
                sessionStorage.removeItem("bookingResult")
                sessionStorage.removeItem("apiBookingNumber")
              } catch (firestoreError) {
                console.error("Error saving booking to Firestore from confirmation page:", firestoreError)
                // Pentru plățile Stripe, nu afișăm eroare critică dacă webhook-ul a funcționat
                toast({
                  title: "Plată confirmată",
                  description: "Plata a fost procesată cu succes. Rezervarea a fost înregistrată.",
                  variant: "default",
                })
              }
            }
            break
          case "processing":
            setMessage("Plata este în curs de procesare. Vă vom notifica când se finalizează.")
            setStatus("loading") // Sau un status specific "processing"
            break
          case "requires_payment_method":
            setMessage("Plata a eșuat. Vă rugăm să încercați o altă metodă de plată.")
            setStatus("error")
            router.push("/plasare-comanda?error=payment_failed") // Redirecționează înapoi la checkout
            break
          case "requires_action":
            setMessage("Este necesară o acțiune suplimentară pentru a finaliza plata.")
            setStatus("requires_action")
            break
          default:
            setMessage("Status neașteptat al plății.")
            setStatus("error")
            break
        }
      }
    }
    processPayment()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, router, toast]) // Am adăugat toast la dependențe

  return (
    <div className="max-w-7xl mx-auto">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8 mb-8">
        <div className="flex flex-col items-center text-center">
          {status === "loading" && (
            <>
              <Loader2 className="h-16 w-16 text-primary animate-spin mb-6" />
              <h1 className="text-3xl font-bold mb-2">Procesare...</h1>
            </>
          )}
          {status === "success" && (
            <>
              <CheckCircle className="h-16 w-16 text-green-500 metrib-6" />
              <h1 className="text-2xl md:text-3xl font-bold text-gray-800 mb-2">Confirmare Rezervare</h1>
            </>
          )}
          {status === "error" && (
            <>
              <XCircle className="h-16 w-16 text-red-500 metrib-6" />
              <h1 className="text-2xl md:text-3xl font-bold text-gray-800 mb-2">Eroare Tranzacție</h1>
            </>
          )}
          {status === "requires_action" && (
            <>
              <Loader2 className="h-16 w-16 text-amber-500 animate-spin mb-6" />
              <h1 className="text-2xl md:text-3xl font-bold text-gray-800 mb-2">Acțiune Necesară</h1>
            </>
          )}

          <p className="text-gray-600 text-lg mb-8 max-w-xl">{message}</p>

          {status === "success" && reservationDetails && (
            <div className="bg-gray-50 rounded-xl border border-gray-200 p-6 mb-8 w-full max-w-2xl text-left">
              <h2 className="text-xl font-semibold text-gray-700 mb-6 text-center">🎉 Detalii Rezervare Confirmată</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                {/* Afișăm numărul de rezervare DOAR pentru rezervările care au mers la Multipark (nu pay on site) */}
                {bookingNumber && searchParams.get("status") !== "success_pay_on_site" && (
                  <div className="bg-white rounded-lg p-4 border border-green-200">
                    <div className="text-sm text-gray-600 mb-1">Număr Rezervare</div>
                    <div className="text-lg font-bold text-green-600">{bookingNumber}</div>
                  </div>
                )}
                <div className="bg-white rounded-lg p-4 border border-gray-200">
                  <div className="text-sm text-gray-600 mb-1">Număr Înmatriculare</div>
                  <div className="text-lg font-bold">{reservationDetails.licensePlate}</div>
                </div>
                <div className="bg-white rounded-lg p-4 border border-gray-200">
                  <div className="text-sm text-gray-600 mb-1">Data Intrare</div>
                  <div className="font-bold">{reservationDetails.formattedStartDate}</div>
                  <div className="text-sm text-gray-500">ora {reservationDetails.startTime}</div>
                </div>
                <div className="bg-white rounded-lg p-4 border border-gray-200">
                  <div className="text-sm text-gray-600 mb-1">Data Ieșire</div>
                  <div className="font-bold">{reservationDetails.formattedEndDate}</div>
                  <div className="text-sm text-gray-500">ora {reservationDetails.endTime}</div>
                </div>
                <div className="bg-white rounded-lg p-4 border border-gray-200">
                  <div className="text-sm text-gray-600 mb-1">Durată</div>
                  <div className="text-lg font-bold">{reservationDetails.days} {reservationDetails.days === 1 ? 'zi' : 'zile'}</div>
                </div>
                <div className="bg-gradient-to-r from-green-50 to-green-100 rounded-lg p-4 border border-green-200">
                  <div className="text-sm text-green-700 mb-1">
                    {searchParams.get("status") === "success_pay_on_site" ? "Total de Plată (la parcare)" : "Total Plătit"}
                  </div>
                  <div className="text-xl font-bold text-green-600">{reservationDetails.price.toFixed(2)} LEI</div>
                  {searchParams.get("status") === "success_pay_on_site" && (
                    <div className="text-xs text-orange-600 mt-1 font-medium">
                      💳 Se plătește la sosirea în parcare
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                <h3 className="font-medium text-blue-800 mb-2">Următorii Pași</h3>
                <ul className="text-sm text-blue-700 space-y-1">
                  {searchParams.get("status") === "success_pay_on_site" ? (
                    <>
                      <li>• Veți primi un email de confirmare</li>
                      <li>• Prezentați-vă cu maximum 2 ore înainte de ora rezervată</li>
                      <li className="text-orange-700 font-medium">💳 Plătiți tariful la sosirea în parcare ({reservationDetails.price.toFixed(2)} LEI)</li>
                      <li>• Prezentați confirmarea email-ului la recepția parcării</li>
                    </>
                  ) : (
                    <>
                      <li>• Veți primi un email de confirmare cu codul QR</li>
                      <li>• Folosiți codul QR pentru accesul la parcare</li>
                      <li>• Prezentați-vă cu maximum 2 ore înainte de ora rezervată</li>
                    </>
                  )}
                </ul>
              </div>

              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                <h3 className="font-medium text-green-800 mb-2">Locația Parcării</h3>
                <p className="text-sm text-green-700 mb-3">
                  <strong>Str. Calea Bucureştilor, Nr.303A1, Otopeni, Ilfov</strong>
                  <br />
                  La doar 500 metri de Aeroportul Henri Coandă București
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <a
                    href="https://maps.app.goo.gl/GhoVMNWvst6BamHx5?g_st=aw"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 bg-[#ee7f1a] hover:bg-[#d67016] text-white px-4 py-2 rounded-md transition-all duration-200 font-medium text-sm"
                  >
                    Google Maps
                  </a>
                  <a
                    href="https://waze.com/ul?ll=44.575660,26.069918&navigate=yes"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 bg-[#0099ff] hover:bg-[#007acc] text-white px-4 py-2 rounded-md transition-all duration-200 font-medium text-sm"
                  >
                    Waze
                  </a>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button asChild className="gradient-bg px-8 py-3">
              <Link href="/">Pagina Principală</Link>
            </Button>
            {status === "success" && (
              <Button asChild variant="outline" className="px-8 py-3">
                <Link href="/rezerva">Rezervare Nouă</Link>
              </Button>
            )}
            {status === "error" && (
              <Button asChild variant="outline" className="px-8 py-3">
                <Link href="/plasare-comanda">Încearcă din nou</Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Folosim Suspense pentru a gestiona parametrii de căutare
export default function ConfirmationPage() {
  return (
    <main className="min-h-screen bg-gray-50">
      {/* <Header /> */}
      <div className="container mx-auto px-4 py-8 md:py-12">
        <CheckoutSteps activeStep={3} />
        <Suspense
          fallback={
            <div className="max-w-7xl mx-auto">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8 mb-8">
                <div className="flex flex-col items-center text-center">
                  <Loader2 className="h-16 w-16 text-primary animate-spin mb-6" />
                  <h1 className="text-2xl md:text-3xl font-bold mb-2">Se încarcă detaliile confirmării...</h1>
                  <p className="text-gray-600">Vă rugăm să așteptați...</p>
                </div>
              </div>
            </div>
          }
        >
          <ConfirmationContent />
        </Suspense>
      </div>
      {/* <Footer /> */}
    </main>
  )
}
