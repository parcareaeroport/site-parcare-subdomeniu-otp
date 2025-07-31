"use client"

import type React from "react"
import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { AlertCircle, Info, TestTube } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { loadStripe } from "@stripe/stripe-js"
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js"
import { createBooking, createBookingWithFirestore } from "@/app/actions/booking-actions"
import { normalizeLicensePlate } from "@/lib/utils"

// Inițializăm Stripe cu cheia publică
const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "")

// Componenta de formular de plată Stripe
function CheckoutForm({
  clientSecret,
  orderData,
  onSuccess,
}: {
  clientSecret: string
  orderData: any
  onSuccess: (paymentIntentId: string) => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [isLoading, setIsLoading] = useState(false)
  const { toast } = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!stripe || !elements) {
      return
    }

    setIsLoading(true)

    try {
      // Confirmăm plata
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/payment-callback`,
        },
        redirect: "if_required",
      })

      if (error) {
        // Afișăm toast cu eroare detaliată în formularul de checkout
        const getErrorMessage = (errorCode: string, declineCode?: string) => {
          const errorMessages: Record<string, { title: string; description: string }> = {
            'card_declined': {
              title: 'Card respins',
              description: declineCode === 'insufficient_funds' 
                ? 'Fonduri insuficiente pe card. Verificați soldul sau folosiți alt card.'
                : declineCode === 'lost_card'
                ? 'Cardul a fost raportat ca pierdut. Contactați banca sau folosiți alt card.'
                : declineCode === 'stolen_card' 
                ? 'Cardul a fost raportat ca furat. Contactați banca sau folosiți alt card.'
                : 'Cardul a fost respins de bancă. Verificați datele sau folosiți alt card.'
            },
            'expired_card': {
              title: 'Card expirat',
              description: 'Cardul a expirat. Verificați data de expirare sau folosiți alt card.'
            },
            'incorrect_cvc': {
              title: 'CVC incorect',
              description: 'Codul de securitate (CVC) este incorect. Verificați codul de pe spatele cardului.'
            },
            'incorrect_number': {
              title: 'Număr card invalid',
              description: 'Numărul cardului nu este valid. Verificați numerele introduse.'
            },
            'processing_error': {
              title: 'Eroare de procesare',
              description: 'Eroare temporară la procesare. Încercați din nou în câteva minute.'
            }
          }
          
          return errorMessages[errorCode] || {
            title: 'Eroare plată',
            description: error.message || 'A apărut o eroare la procesarea plății. Încercați din nou.'
          }
        }

        const errorMsg = getErrorMessage(error.code || 'unknown', error.decline_code)
        
                 toast({
           title: errorMsg.title,
           description: errorMsg.description,
           variant: "destructive",
           duration: error.decline_code === 'lost_card' || error.decline_code === 'stolen_card' ? 10000 : 5000,
         })

        console.log('Payment Error Details:', {
          code: error.code,
          message: error.message,
          decline_code: error.decline_code,
          type: error.type
        })
      } else if (paymentIntent && paymentIntent.status === "succeeded") {
        // Plata a reușit, apelăm callback-ul de succes
        onSuccess(paymentIntent.id)
      }
    } catch (error: any) {
      toast({
        title: "Eroare",
        description: error.message || "A apărut o eroare neașteptată.",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <PaymentElement 
        options={{
          paymentMethodOrder: ['card']
        }}
      />

      <Button
        type="submit"
        className="w-full gradient-bg hover:opacity-90 py-6 text-base font-medium rounded-md"
        disabled={isLoading || !stripe || !elements}
      >
        {isLoading ? "Se procesează..." : "Plătește acum"}
      </Button>
    </form>
  )
}

export default function OrderPlacementForm() {
  const router = useRouter()
  const { toast } = useToast()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState("card")
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  
  // Add ref for payment section
  const paymentSectionRef = useRef<HTMLDivElement>(null)

  // Add useEffect to handle scroll when payment form is shown
  useEffect(() => {
    if (showPaymentForm) {
      const scrollTop = () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        window.scrollTo(0, 0); // instant fallback
        document.body.scrollTop = 0;
        document.documentElement.scrollTop = 0;
      }
      scrollTop();
      // Extra attempts in case content height changes after initial render (iOS quirk)
      const t1 = setTimeout(scrollTop, 150);
      const t2 = setTimeout(scrollTop, 400);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [showPaymentForm])
 
  // Detalii client
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [address, setAddress] = useState("")
  const [city, setCity] = useState("")
  const [county, setCounty] = useState("")
  const [postalCode, setPostalCode] = useState("")
  const [country, setCountry] = useState("România")
  const [company, setCompany] = useState("")
  const [companyVAT, setCompanyVAT] = useState("")
  const [companyReg, setCompanyReg] = useState("")
  const [companyAddress, setCompanyAddress] = useState("")
  const [orderNotes, setOrderNotes] = useState("")
  const [needInvoice, setNeedInvoice] = useState(false)
  const [numberOfPersons, setNumberOfPersons] = useState("1")

  // Reservation data state
  const [reservationData, setReservationData] = useState<any>(null)
  const [orderData, setOrderData] = useState<any>(null)

  // Load reservation data from sessionStorage and check for error parameters
  useEffect(() => {
    // Check for error parameter in URL
    const urlParams = new URLSearchParams(window.location.search)
    const errorParam = urlParams.get('error')
    
    if (errorParam === 'payment_failed') {
      toast({
        title: "Plată eșuată",
        description: "Plata anterioară a eșuat. Verificați datele cardului sau încercați cu un alt card.",
        variant: "destructive",
      })
      // Clear the error parameter from URL
      window.history.replaceState({}, '', window.location.pathname)
    }
    
    try {
      const storedData = sessionStorage.getItem("reservationData")
      if (storedData) {
        const parsedData = JSON.parse(storedData)
        setReservationData(parsedData)
      } else {
        toast({
          title: "Eroare",
          description: "Nu s-au găsit date pentru rezervare. Vă rugăm să completați formularul de rezervare.",
          variant: "destructive",
        })
        router.push("/")
      }
    } catch (error) {
      console.error("Error parsing reservation data:", error)
      toast({
        title: "Eroare",
        description: "Nu s-au putut încărca datele rezervării. Vă rugăm să încercați din nou.",
        variant: "destructive",
      })
      router.push("/")
    }
  }, [router, toast])

  // Calculate discount and total
  const calculateDiscount = () => {
    if (!reservationData) return 0
    // 10% reducere pentru plăți online cu cardul
    if (paymentMethod === "card") {
      return Math.round(reservationData.price * 0.1)
    }
    return 0
  }

  const calculateTotal = () => {
    if (!reservationData) return 0
    const discount = calculateDiscount()
    return reservationData.price - discount
  }

  // Pay on site booking function
  const handlePayOnSiteBooking = async () => {
    if (!reservationData) {
      toast({
        title: "Eroare",
        description: "Datele rezervării lipsesc.",
        variant: "destructive",
      })
      return
    }

    // Validare email obligatoriu pentru plata la parcare
    if (!email || !email.trim()) {
      toast({
        title: "Email obligatoriu",
        description: "Email-ul este obligatoriu pentru rezervările cu plată la parcare pentru a primi confirmarea și QR code-ul.",
        variant: "destructive",
      })
      return
    }

    // Validare email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      toast({
        title: "Email invalid",
        description: "Vă rugăm să introduceți o adresă de email validă.",
        variant: "destructive",
      })
      return
    }

    setIsSubmitting(true)

    const payOnSiteProcessId = `PAY_ON_SITE_${Date.now()}`

    try {
      // Pregătim FormData pentru API-ul direct
      const formData = new FormData()
      formData.append("licensePlate", normalizeLicensePlate(reservationData.licensePlate))
      formData.append("startDate", reservationData.startDate)
      formData.append("startTime", reservationData.startTime)
      formData.append("endDate", reservationData.endDate)
      formData.append("endTime", reservationData.endTime)
      formData.append("clientName", `${firstName} ${lastName}`.trim())
      if (firstName) formData.append("clientTitle", firstName)
      
      console.log(`🚀 [${payOnSiteProcessId}] ===== PAY ON SITE PROCESS STARTED =====`)
      console.log(`🚀 [${payOnSiteProcessId}] Timestamp: ${new Date().toISOString()}`)
      console.log(`🚀 [${payOnSiteProcessId}] Environment: ${process.env.NODE_ENV}`)
      console.log(`🚀 [${payOnSiteProcessId}] Email provided: ${email}`)
      console.log(`🚀 [${payOnSiteProcessId}] Phone provided: ${phone}`)
      console.log(`🚀 [${payOnSiteProcessId}] Total amount: ${calculateTotal()} RON`)
      console.log(`🚀 [${payOnSiteProcessId}] Number of days: ${reservationData.days}`)
              console.log(`🚀 [${payOnSiteProcessId}] License plate: ${normalizeLicensePlate(reservationData.licensePlate)}`)
        console.log(`🚀 [${payOnSiteProcessId}] Date range: ${reservationData.startDate} ${reservationData.startTime} - ${reservationData.endDate} ${reservationData.endTime}`)
        console.log(`🚀 [${payOnSiteProcessId}] Client name: ${firstName} ${lastName}`)
        console.log(`🚀 [${payOnSiteProcessId}] Complete booking data:`, {
          licensePlate: normalizeLicensePlate(reservationData.licensePlate),
        startDate: reservationData.startDate,
        startTime: reservationData.startTime,
        endDate: reservationData.endDate,
        endTime: reservationData.endTime,
        clientName: `${firstName} ${lastName}`.trim(),
        clientEmail: email,
        clientPhone: phone,
        amount: calculateTotal(),
        days: reservationData.days,
        source: "pay_on_site"
      })

      console.log(`📧 [${payOnSiteProcessId}] Email will be sent automatically to: ${email}`)
      console.log(`📧 [${payOnSiteProcessId}] After multipark API confirms reservation and generates QR code`)
      console.log(`📧 [${payOnSiteProcessId}] QR code will be generated for access`)

      // Apelează noua funcție cu salvare completă în Firestore
      console.log(`🔄 [${payOnSiteProcessId}] Calling createBookingWithFirestore...`)
      const bookingStartTime = Date.now()
      
      const result = await createBookingWithFirestore(formData, {
        clientEmail: email,
        clientPhone: phone,
        numberOfPersons: parseInt(numberOfPersons) || 1,
        paymentStatus: "pending", // Plată în așteptare
        amount: calculateTotal(),
        days: reservationData.days,
        source: "pay_on_site",
        // Date pentru facturare și adresă
        company: needInvoice ? company : undefined,
        companyVAT: needInvoice ? companyVAT : undefined,
        companyReg: needInvoice ? companyReg : undefined,
        companyAddress: needInvoice ? companyAddress : undefined,
        needInvoice: needInvoice,
        address: address,
        city: city,
        county: county,
        postalCode: postalCode,
        orderNotes: orderNotes,
        // Termeni și condiții
        termsAccepted: acceptTerms
      })

      const bookingDuration = Date.now() - bookingStartTime
      console.log(`📊 [${payOnSiteProcessId}] Booking API call completed in ${bookingDuration}ms`)
      
      console.log(`📋 [${payOnSiteProcessId}] Booking result:`)
      console.log(`📋 [${payOnSiteProcessId}]   Success: ${result.success}`)
      console.log(`📋 [${payOnSiteProcessId}]   Message: ${result.message}`)
      console.log(`📋 [${payOnSiteProcessId}]   Booking Number: ${'bookingNumber' in result ? result.bookingNumber : 'N/A'}`)
      console.log(`📋 [${payOnSiteProcessId}]   Firestore Success: ${'firestoreSuccess' in result ? result.firestoreSuccess : 'N/A'}`)
      console.log(`📋 [${payOnSiteProcessId}]   Firestore ID: ${'firestoreId' in result ? result.firestoreId : 'N/A'}`)
      console.log(`📋 [${payOnSiteProcessId}] Full result from server:`, result)

      // Log pentru debugging doar în caz de eroare
      const hasFirestoreSuccess = 'firestoreSuccess' in result ? result.firestoreSuccess : false
      if (!result.success || !hasFirestoreSuccess) {
        console.error(`🚨 [${payOnSiteProcessId}] Booking issues detected:`)
        if ('debugLogs' in result && result.debugLogs) {
          result.debugLogs.forEach((log, index) => {
            console.log(`${index + 1}. ${log}`)
          })
        }
      }

      if (result.success) {
        // Type guards pentru proprietățile opționale
        const bookingNumber = 'bookingNumber' in result ? result.bookingNumber : null
        const firestoreId = 'firestoreId' in result ? result.firestoreId : null
        
        console.log(`✅ [${payOnSiteProcessId}] ===== BOOKING CONFIRMED =====`)
        console.log(`✅ [${payOnSiteProcessId}] Reservation created successfully!`)
        console.log(`✅ [${payOnSiteProcessId}] Booking Number: ${bookingNumber}`)
        console.log(`✅ [${payOnSiteProcessId}] Firestore ID: ${firestoreId}`)
        console.log(`✅ [${payOnSiteProcessId}] Client Email: ${email}`)
        console.log(`✅ [${payOnSiteProcessId}] Success timestamp: ${new Date().toISOString()}`)
        console.log(`✅ [${payOnSiteProcessId}] Email will be sent automatically with QR code`)
        
        const successMessage = hasFirestoreSuccess 
          ? `Rezervarea ${bookingNumber} a fost creată cu succes! Veți plăti la parcare. Email-ul de confirmare va fi trimis automat cu QR code-ul.`
          : `Rezervarea ${bookingNumber} a fost creată la API, dar nu s-a putut salva local.`
        
        toast({
          title: "Succes!",
          description: successMessage,
          variant: "default",
        })

        // Salvează datele complete pentru pagina de confirmare
        const completeReservationData = {
          ...reservationData,
          clientName: `${firstName} ${lastName}`.trim(),
          clientEmail: email,
          clientPhone: phone,
          apiBookingNumber: bookingNumber,
          firestoreId: firestoreId,
          amount: calculateTotal(),
          status: "confirmed_pay_on_site"
        }

        sessionStorage.setItem("reservationDataForConfirmation", JSON.stringify(completeReservationData))

        // Redirectează la pagina de confirmare cu parametrii de plată la parcare
        const confirmationUrl = `/confirmare?bookingNumber=${bookingNumber}&status=success_pay_on_site&firestoreId=${firestoreId || ''}`
        console.log(`↗️ [${payOnSiteProcessId}] Redirecting to: ${confirmationUrl}`)
        router.push(confirmationUrl)
      } else {
        console.error(`❌ [${payOnSiteProcessId}] ===== BOOKING FAILED =====`)
        console.error(`❌ [${payOnSiteProcessId}] Error message: ${result.message}`)
        console.error(`❌ [${payOnSiteProcessId}] Firestore error: ${'firestoreError' in result ? result.firestoreError : 'N/A'}`)
        console.error(`❌ [${payOnSiteProcessId}] Email will not be sent due to booking error`)
        console.error(`❌ [${payOnSiteProcessId}] Failed timestamp: ${new Date().toISOString()}`)
        
        toast({
          title: "Eroare la rezervare",
          description: result.message || "A apărut o eroare la crearea rezervării.",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error(`💥 [${payOnSiteProcessId}] ===== BOOKING EXCEPTION =====`)
      console.error(`💥 [${payOnSiteProcessId}] Error type: ${error instanceof Error ? error.constructor.name : typeof error}`)
      console.error(`💥 [${payOnSiteProcessId}] Error message: ${error instanceof Error ? error.message : String(error)}`)
      console.error(`💥 [${payOnSiteProcessId}] Error stack:`, error instanceof Error ? error.stack : 'N/A')
      console.error(`💥 [${payOnSiteProcessId}] Email will not be sent due to technical error`)
      console.error(`💥 [${payOnSiteProcessId}] Exception timestamp: ${new Date().toISOString()}`)
      
      toast({
        title: "Eroare",
        description: "A apărut o eroare tehnică la crearea rezervării. Verificați consola pentru detalii.",
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
      console.log(`🏁 [${payOnSiteProcessId}] Pay on site process completed`)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!acceptTerms) {
      toast({
        title: "Eroare",
        description: "Trebuie să acceptați termenii și condițiile pentru a continua.",
        variant: "destructive",
      })
      return
    }

    if (!reservationData) {
      toast({
        title: "Eroare",
        description: "Datele rezervării lipsesc. Vă rugăm să încercați din nou.",
        variant: "destructive",
      })
      return
    }

    // Dacă este plată la parcare, apelează direct API-ul
    if (paymentMethod === "pay_on_site") {
      await handlePayOnSiteBooking()
      return
    }

    setIsSubmitting(true)

    try {
      // Pregătim datele pentru comandă
      const completeOrderData = {
        reservationData,
        customerInfo: {
          firstName,
          lastName,
          email,
          phone,
          numberOfPersons: parseInt(numberOfPersons) || 1,
          address,
          city,
          county,
          postalCode,
          country,
          company: needInvoice ? company : "",
          companyVAT: needInvoice ? companyVAT : "",
          companyReg: needInvoice ? companyReg : "",
          companyAddress: needInvoice ? companyAddress : "",
          notes: orderNotes,
        },
        paymentMethod,
        total: calculateTotal(),
        orderId: `PO-${Date.now()}`,
      }

      // Salvăm datele comenzii
      setOrderData(completeOrderData)
      sessionStorage.setItem("completeOrderData", JSON.stringify(completeOrderData))

      // Creăm o intenție de plată în Stripe
      const response = await fetch("/api/create-payment-intent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: calculateTotal(),
          bookingData: {
            licensePlate: normalizeLicensePlate(reservationData.licensePlate),
            startDate: `${reservationData.startDate}T${reservationData.startTime}:00`,
            endDate: `${reservationData.endDate}T${reservationData.endTime}:00`,
          },
          customerInfo: {
            firstName,
            lastName,
            email,
            phone,
            numberOfPersons: parseInt(numberOfPersons) || 1,
            address,
            city,
            county,
            postalCode,
            country,
            company: needInvoice ? company : undefined,
            companyVAT: needInvoice ? companyVAT : undefined,
            companyReg: needInvoice ? companyReg : undefined,
            companyAddress: needInvoice ? companyAddress : undefined,
            notes: orderNotes,
            needInvoice: needInvoice,
            termsAccepted: acceptTerms,
          },
          orderId: completeOrderData.orderId,
        }),
      })

      const { clientSecret, error } = await response.json()

      if (error) {
        throw new Error(error)
      }

      // Salvăm client secret și afișăm formularul de plată
      setClientSecret(clientSecret)
      setShowPaymentForm(true)
      setIsSubmitting(false)
    } catch (error: any) {
      console.error("Order submission error:", error)
      toast({
        title: "Eroare",
        description: "A apărut o eroare la procesarea comenzii. Vă rugăm să încercați din nou.",
        variant: "destructive",
      })
      setIsSubmitting(false)
    }
  }

  const handlePaymentSuccess = (paymentIntentId: string) => {
    // Salvăm ID-ul plății și redirecționăm către pagina de confirmare
    if (orderData) {
      const bookingResult = {
        ...orderData,
        bookingNumber: `PO-${Date.now()}`,
        success: true,
        transactionId: paymentIntentId,
      }

      sessionStorage.setItem("bookingResult", JSON.stringify(bookingResult))
      
      // Redirectăm cu parametrii PaymentIntent pentru compatibilitate
      const confirmationUrl = new URL("/confirmare", window.location.origin)
      confirmationUrl.searchParams.set("payment_intent", paymentIntentId)
      confirmationUrl.searchParams.set("redirect_status", "succeeded")
      
      router.push(confirmationUrl.toString())
    }
  }

  if (!reservationData) {
    return (
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8 mb-8">
          <h1 className="text-2xl md:text-3xl font-bold mb-6 text-center">
            {showPaymentForm ? "Finalizare plată" : "Plasare comandă"}
          </h1>

          <div className="flex flex-col lg:flex-row gap-8">
            {/* Left column - Customer details form or Payment form */}
            <div className="flex-1">
              {showPaymentForm && clientSecret ? (
                <div
                  className="w-full bg-white p-0 border-0 rounded-none md:p-6 md:rounded-xl md:border border-gray-200"
                  style={{ maxWidth: '100%' }}
                  data-payment-mobile-container
                >
                  <h2 className="text-lg font-bold mb-4">Plată securizată</h2>
                  <Elements 
                    stripe={stripePromise} 
                    options={{ 
                      clientSecret,
                      locale: 'ro',
                      appearance: {
                        theme: 'stripe',
                        variables: {
                          colorPrimary: '#E6005C',
                          colorBackground: '#ffffff',
                          colorText: '#1a1a1a',
                          colorDanger: '#df1b41',
                          fontFamily: 'system-ui, sans-serif',
                          spacingUnit: '8px',
                          borderRadius: '8px',
                        },
                        rules: {
                          '.Input': {
                            border: '1px solid #d1d5db',
                            padding: '12px',
                            fontSize: '16px',
                          },
                          '.Input:focus': {
                            border: '1px solid #E6005C',
                            boxShadow: '0 0 0 2px rgba(230, 0, 92, 0.2)',
                          },
                          '.Label': {
                            fontSize: '14px',
                            fontWeight: '500',
                            color: '#374151',
                            marginBottom: '6px',
                          },
                          '.Tab': {
                            border: '1px solid #d1d5db',
                            borderRadius: '8px',
                            padding: '12px',
                          },
                          '.Tab:hover': {
                            backgroundColor: '#f9fafb',
                          },
                          '.Tab--selected': {
                            border: '1px solid #E6005C',
                            backgroundColor: '#fef7f0',
                          },
                          '.p-Link': {
                            display: 'none !important',
                          },
                          '.p-LinkModal': {
                            display: 'none !important',
                          },
                          '[data-testid="link-authentication-element"]': {
                            display: 'none !important',
                          },
                          '.Link': {
                            display: 'none !important',
                          },
                          '[class*="Link"]': {
                            display: 'none !important',
                          }
                        }
                      }
                    }}
                  >
                    <CheckoutForm clientSecret={clientSecret} orderData={orderData} onSuccess={handlePaymentSuccess} />
                  </Elements>
                </div>
              ) : (
                <>
                {/* Test mode toggle - removed completely */}

                <form onSubmit={handleSubmit}>
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-lg font-bold mb-4">Detalii pentru facturare</h2>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="firstName">Prenume</Label>
                          <Input
                            id="firstName"
                            placeholder="Prenumele dvs."
                            required
                            value={firstName}
                            onChange={(e) => setFirstName(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label htmlFor="lastName">Nume</Label>
                          <Input
                            id="lastName"
                            placeholder="Numele dvs."
                            required
                            value={lastName}
                            onChange={(e) => setLastName(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="email@exemplu.com"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>

                    <div>
                      <Label htmlFor="phone">Telefon</Label>
                      <Input
                        id="phone"
                        placeholder="07xx xxx xxx"
                        required
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    </div>

                    <div>
                      <Label htmlFor="numberOfPersons">Număr persoane</Label>
                      <Input
                        id="numberOfPersons"
                        type="number"
                        min="1"
                        max="10"
                        placeholder="1"
                        required
                        value={numberOfPersons}
                        onChange={(e) => setNumberOfPersons(e.target.value)}
                      />
                    </div>

                    <div>
                      <Label htmlFor="address">Adresă</Label>
                      <Textarea
                        id="address"
                        placeholder="Adresa dvs. completă"
                        rows={3}
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <Label htmlFor="city">Oraș</Label>
                        <Input
                          id="city"
                          placeholder="Orașul dvs."
                          value={city}
                          onChange={(e) => setCity(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label htmlFor="county">Județ</Label>
                        <Input
                          id="county"
                          placeholder="Județului dvs."
                          value={county}
                          onChange={(e) => setCounty(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label htmlFor="country">Țara</Label>
                        <Input
                          id="country"
                          placeholder="Țara"
                          required
                          value={country}
                          onChange={(e) => setCounty(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="pt-4 border-t border-gray-200">
                      <div className="flex items-start space-x-2 mb-4">
                        <Checkbox
                          id="needInvoice"
                          checked={needInvoice}
                          onCheckedChange={(checked) => setNeedInvoice(checked === true)}
                        />
                        <Label htmlFor="needInvoice" className="text-sm">
                          Doresc factură pentru persoană juridică
                        </Label>
                      </div>

                      {needInvoice && (
                        <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
                          <div>
                            <Label htmlFor="company">Denumire firmă</Label>
                            <Input
                              id="company"
                              placeholder="Denumirea firmei"
                              value={company}
                              onChange={(e) => setCompany(e.target.value)}
                            />
                          </div>
                          <div>
                            <Label htmlFor="companyVAT">CUI / CIF</Label>
                            <Input
                              id="companyVAT"
                              placeholder="Codul fiscal"
                              value={companyVAT}
                              onChange={(e) => setCompanyVAT(e.target.value)}
                            />
                          </div>
                          <div>
                            <Label htmlFor="companyReg">Număr Registrul Comerțului</Label>
                            <Input
                              id="companyReg"
                              placeholder="J40/12345/2023"
                              value={companyReg}
                              onChange={(e) => setCompanyReg(e.target.value)}
                            />
                          </div>
                          <div>
                            <Label htmlFor="companyAddress">Adresa firmei</Label>
                            <Textarea
                              id="companyAddress"
                              placeholder="Adresa completă a firmei"
                              rows={3}
                              value={companyAddress}
                              onChange={(e) => setCompanyAddress(e.target.value)}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    <div>
                      <Label htmlFor="notes">Observații comandă</Label>
                      <Textarea
                        id="notes"
                        placeholder="Observații speciale pentru comanda dvs."
                        rows={3}
                        value={orderNotes}
                        onChange={(e) => setOrderNotes(e.target.value)}
                      />
                    </div>

                    <div>
                      <h2 className="text-lg font-bold mb-4">Metodă de plată</h2>

                      <div className="space-y-3">
                        <div className="flex items-center space-x-2 border border-gray-200 rounded-lg p-4 hover:border-primary/50 transition-colors">
                          <input
                            type="radio"
                            id="card"
                            name="paymentMethod"
                            value="card"
                            checked={paymentMethod === "card"}
                            onChange={() => setPaymentMethod("card")}
                            className="h-4 w-4 text-primary"
                          />
                          <Label htmlFor="card" className="flex-1 cursor-pointer">
                            <div className="flex flex-col">
                              <span>Plată online cu cardul (Stripe)</span>
                              <span className="text-sm text-green-600 font-medium">10% reducere pentru plata online cu cardul</span>
                            </div>
                          </Label>
                        </div>

                        {/* <div className="flex items-center space-x-2 border border-gray-200 rounded-lg p-4 hover:border-primary/50 transition-colors">
                          <input
                            type="radio"
                            id="pay_on_site"
                            name="paymentMethod"
                            value="pay_on_site"
                            checked={paymentMethod === "pay_on_site"}
                            onChange={() => setPaymentMethod("pay_on_site")}
                            className="h-4 w-4 text-primary"
                          />
                          <Label htmlFor="pay_on_site" className="flex-1 cursor-pointer">
                            <div className="flex flex-col">
                              <span>Plată la parcare</span>
                              <span className="text-sm text-gray-500">Plătiți când ajungeți la parcare</span>
                            </div>
                          </Label>
                        </div> */}
                      </div>
                    </div>

                    <div className="pt-4 border-t border-gray-200">
                      <div className="flex items-start space-x-2">
                        <Checkbox
                          id="terms"
                          checked={acceptTerms}
                          onCheckedChange={(checked) => setAcceptTerms(checked === true)}
                        />
                        <Label htmlFor="terms" className="text-sm">
                          Am citit și sunt de acord cu{" "}
                          <Link href="/termeni" className="text-primary hover:underline">
                            Termenii și Condițiile
                          </Link>{" "}
                          și{" "}
                          <Link href="/confidentialitate" className="text-primary hover:underline">
                            Politica de Confidențialitate
                          </Link>
                        </Label>
                      </div>
                    </div>

                    <Button
                      type="submit"
                      className="w-full gradient-bg hover:opacity-90 py-6 text-base font-medium rounded-md"
                      disabled={isSubmitting || !acceptTerms}
                    >
                      {isSubmitting ? "Se procesează..." : paymentMethod === "pay_on_site" ? "Confirmă rezervarea" : "Continuă spre plată"}
                    </Button>
                  </div>
                </form>
                  {/* Mobile Order Summary - visible only on mobile */}
                  <div className="lg:hidden bg-gray-50 rounded-xl p-6 mb-6">
                    <h2 className="text-lg font-bold mb-4">Sumar comandă</h2>
                    {reservationData && (
                      <div className="space-y-4">
                        <div className="flex justify-between items-center">
                          <span className="text-gray-600">Număr înmatriculare:</span>
                          <span className="font-medium">{reservationData.licensePlate}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-gray-600">Data intrare:</span>
                          <span className="font-medium">
                            {new Date(reservationData.startDate).toLocaleDateString("ro-RO").replace(/\./g, '/')} {reservationData.startTime}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-gray-600">Data ieșire:</span>
                          <span className="font-medium">
                            {new Date(reservationData.endDate).toLocaleDateString("ro-RO").replace(/\./g, '/')} {reservationData.endTime}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-gray-600">Durată:</span>
                          <span className="font-medium">{reservationData.duration}</span>
                        </div>
                        <div className="pt-4 border-t border-gray-200">
                          <div className="flex justify-between items-center">
                            <span className="text-gray-600">Preț:</span>
                            <span className="font-medium">{reservationData.price} RON</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="bg-primary/5 rounded-xl p-4 mb-6">
                    <h2 className="text-lg font-bold mb-2 flex items-center">
                      <Info className="h-5 w-5 mr-2 text-primary" />
                      PARCARE AUTOTURISM
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <ul className="space-y-2 text-sm">
                        <li className="flex items-start">
                          <span className="text-primary mr-2">•</span>
                          <span>ASFALTATĂ</span>
                        </li>
                        <li className="flex items-start">
                          <span className="text-primary mr-2">•</span>
                          <span>Spațiu de parcare suficient și bine organizat</span>
                        </li>
                        <li className="flex items-start">
                          <span className="text-primary mr-2">•</span>
                          <span>Supraveghere video 24/7</span>
                        </li>
                        <li className="flex items-start">
                          <span className="text-primary mr-2">•</span>
                          <span>Transfer gratuit la aeroport</span>
                        </li>
                      </ul>
                      <ul className="space-y-2 text-sm">
                        <li className="flex items-start">
                          <span className="text-primary mr-2">•</span>
                          <span>Infrastructură de înaltă calitate</span>
                        </li>
                        <li className="flex items-start">
                          <span className="text-primary mr-2">•</span>
                          <span>Acces direct din DN1</span>
                        </li>
                        <li className="flex items-start">
                          <span className="text-primary mr-2">•</span>
                          <span>Parcare împrejmuită cu gard</span>
                        </li>
                        <li className="flex items-start">
                          <span className="text-primary mr-2">•</span>
                          <span>Iluminat STÂLPI DE ILUMINARE ELECTRICĂ</span>
                        </li>
                      </ul>
                    </div>

                    <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-start">
                      <AlertCircle className="h-5 w-5 text-yellow-600 mr-2 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-yellow-800">
                        Anularea rezervărilor de parcare făcute cu minim 24 de ore înainte de data și ora intrării în
                        parcare!
                      </p>
                    </div>
                  </div>

                </>
              )}
            </div>

            {/* Right column - Order summary */}
            <div className="lg:w-[400px]">
              <div className="bg-gray-50 rounded-xl p-6 sticky top-6">
                <h2 className="text-lg font-bold mb-4">Sumar comandă</h2>
                {reservationData && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">Număr înmatriculare:</span>
                      <span className="font-medium">{reservationData.licensePlate}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">Data intrare:</span>
                      <span className="font-medium">
                        {new Date(reservationData.startDate).toLocaleDateString("ro-RO").replace(/\./g, '/')} {reservationData.startTime}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">Data ieșire:</span>
                      <span className="font-medium">
                        {new Date(reservationData.endDate).toLocaleDateString("ro-RO").replace(/\./g, '/')} {reservationData.endTime}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">Durată:</span>
                      <span className="font-medium">{reservationData.duration}</span>
                    </div>
                    <div className="pt-4 border-t border-gray-200">
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-gray-600">Preț original:</span>
                          <span className="font-medium">{reservationData.price} RON</span>
                        </div>
                        {calculateDiscount() > 0 && (
                          <div className="flex justify-between items-center">
                            <span className="text-green-600">Reducere (10%):</span>
                            <span className="font-medium text-green-600">-{calculateDiscount()} RON</span>
                          </div>
                        )}
                        <div className="flex justify-between items-center pt-2 border-t border-gray-200">
                          <span className="text-lg font-bold">Total de plată:</span>
                          <span className="text-lg font-bold text-primary">{calculateTotal()} RON</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8 mb-8">
        <h1 className="text-2xl md:text-3xl font-bold mb-6 text-center">
          {showPaymentForm ? "Finalizare plată" : "Plasare comandă"}
        </h1>

        <div className="flex flex-col lg:flex-row gap-8">
          {/* Left column - Customer details form or Payment form */}
          <div className="flex-1">
            {showPaymentForm && clientSecret ? (
              <div
                className="w-full bg-white p-0 border-0 rounded-none md:p-6 md:rounded-xl md:border border-gray-200"
                style={{ maxWidth: '100%' }}
                data-payment-mobile-container
              >
                <h2 className="text-lg font-bold mb-4">Plată securizată</h2>
                <Elements 
                  stripe={stripePromise} 
                  options={{ 
                    clientSecret,
                    locale: 'ro',
                    appearance: {
                      theme: 'stripe',
                      variables: {
                        colorPrimary: '#E6005C',
                        colorBackground: '#ffffff',
                        colorText: '#1a1a1a',
                        colorDanger: '#df1b41',
                        fontFamily: 'system-ui, sans-serif',
                        spacingUnit: '8px',
                        borderRadius: '8px',
                      },
                      rules: {
                        '.Input': {
                          border: '1px solid #d1d5db',
                          padding: '12px',
                          fontSize: '16px',
                        },
                        '.Input:focus': {
                          border: '1px solid #E6005C',
                          boxShadow: '0 0 0 2px rgba(230, 0, 92, 0.2)',
                        },
                        '.Label': {
                          fontSize: '14px',
                          fontWeight: '500',
                          color: '#374151',
                          marginBottom: '6px',
                        },
                        '.Tab': {
                          border: '1px solid #d1d5db',
                          borderRadius: '8px',
                          padding: '12px',
                        },
                        '.Tab:hover': {
                          backgroundColor: '#f9fafb',
                        },
                        '.Tab--selected': {
                          border: '1px solid #E6005C',
                          backgroundColor: '#fef7f0',
                        },
                        '.p-Link': {
                          display: 'none !important',
                        },
                        '.p-LinkModal': {
                          display: 'none !important',
                        },
                        '[data-testid="link-authentication-element"]': {
                          display: 'none !important',
                        },
                        '.Link': {
                          display: 'none !important',
                        },
                        '[class*="Link"]': {
                          display: 'none !important',
                        }
                      }
                    }
                  }}
                >
                  <CheckoutForm clientSecret={clientSecret} orderData={orderData} onSuccess={handlePaymentSuccess} />
                </Elements>
              </div>
            ) : (
              <>
                {/* Test mode toggle - removed completely */}

                <form onSubmit={handleSubmit}>
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-lg font-bold mb-4">Detalii pentru facturare</h2>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="firstName">Prenume</Label>
                          <Input
                            id="firstName"
                            placeholder="Prenumele dvs."
                            required
                            value={firstName}
                            onChange={(e) => setFirstName(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label htmlFor="lastName">Nume</Label>
                          <Input
                            id="lastName"
                            placeholder="Numele dvs."
                            required
                            value={lastName}
                            onChange={(e) => setLastName(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="email@exemplu.com"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>

                    <div>
                      <Label htmlFor="phone">Telefon</Label>
                      <Input
                        id="phone"
                        placeholder="07xx xxx xxx"
                        required
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    </div>

                    <div>
                      <Label htmlFor="numberOfPersons">Număr persoane</Label>
                      <Input
                        id="numberOfPersons"
                        type="number"
                        min="1"
                        max="10"
                        placeholder="1"
                        required
                        value={numberOfPersons}
                        onChange={(e) => setNumberOfPersons(e.target.value)}
                      />
                    </div>

                    <div>
                      <Label htmlFor="address">Adresă</Label>
                      <Textarea
                        id="address"
                        placeholder="Adresa dvs. completă"
                        rows={3}
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <Label htmlFor="city">Oraș</Label>
                        <Input
                          id="city"
                          placeholder="Orașul dvs."
                          value={city}
                          onChange={(e) => setCity(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label htmlFor="county">Județ</Label>
                        <Input
                          id="county"
                          placeholder="Județului dvs."
                          value={county}
                          onChange={(e) => setCounty(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label htmlFor="country">Țara</Label>
                        <Input
                          id="country"
                          placeholder="Țara"
                          required
                          value={country}
                          onChange={(e) => setCounty(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="pt-4 border-t border-gray-200">
                      <div className="flex items-start space-x-2 mb-4">
                        <Checkbox
                          id="needInvoice"
                          checked={needInvoice}
                          onCheckedChange={(checked) => setNeedInvoice(checked === true)}
                        />
                        <Label htmlFor="needInvoice" className="text-sm">
                          Doresc factură pentru persoană juridică
                        </Label>
                      </div>

                      {needInvoice && (
                        <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
                          <div>
                            <Label htmlFor="company">Denumire firmă</Label>
                            <Input
                              id="company"
                              placeholder="Denumirea firmei"
                              value={company}
                              onChange={(e) => setCompany(e.target.value)}
                            />
                          </div>
                          <div>
                            <Label htmlFor="companyVAT">CUI / CIF</Label>
                            <Input
                              id="companyVAT"
                              placeholder="Codul fiscal"
                              value={companyVAT}
                              onChange={(e) => setCompanyVAT(e.target.value)}
                            />
                          </div>
                          <div>
                            <Label htmlFor="companyReg">Număr Registrul Comerțului</Label>
                            <Input
                              id="companyReg"
                              placeholder="J40/12345/2023"
                              value={companyReg}
                              onChange={(e) => setCompanyReg(e.target.value)}
                            />
                          </div>
                          <div>
                            <Label htmlFor="companyAddress">Adresa firmei</Label>
                            <Textarea
                              id="companyAddress"
                              placeholder="Adresa completă a firmei"
                              rows={3}
                              value={companyAddress}
                              onChange={(e) => setCompanyAddress(e.target.value)}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    <div>
                      <Label htmlFor="notes">Observații comandă</Label>
                      <Textarea
                        id="notes"
                        placeholder="Observații speciale pentru comanda dvs."
                        rows={3}
                        value={orderNotes}
                        onChange={(e) => setOrderNotes(e.target.value)}
                      />
                    </div>

                    <div>
                      <h2 className="text-lg font-bold mb-4">Metodă de plată</h2>

                      <div className="space-y-3">
                        <div className="flex items-center space-x-2 border border-gray-200 rounded-lg p-4 hover:border-primary/50 transition-colors">
                          <input
                            type="radio"
                            id="card"
                            name="paymentMethod"
                            value="card"
                            checked={paymentMethod === "card"}
                            onChange={() => setPaymentMethod("card")}
                            className="h-4 w-4 text-primary"
                          />
                          <Label htmlFor="card" className="flex-1 cursor-pointer">
                            <div className="flex flex-col">
                              <span>Plată online cu cardul (Stripe)</span>
                              <span className="text-sm text-red-600 font-medium">10% reducere pentru plata online cu cardul</span>
                            </div>
                          </Label>
                        </div>

                        <div className="flex items-center space-x-2 border border-gray-200 rounded-lg p-4 hover:border-primary/50 transition-colors">
                          <input
                            type="radio"
                            id="pay_on_site"
                            name="paymentMethod"
                            value="pay_on_site"
                            checked={paymentMethod === "pay_on_site"}
                            onChange={() => setPaymentMethod("pay_on_site")}
                            className="h-4 w-4 text-primary"
                          />
                          <Label htmlFor="pay_on_site" className="flex-1 cursor-pointer">
                            <div className="flex flex-col">
                              <span>Plată la parcare</span>
                              <span className="text-sm text-gray-500">Plătiți când ajungeți la parcare</span>
                            </div>
                          </Label>
                        </div>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-gray-200">
                      <div className="flex items-start space-x-2">
                        <Checkbox
                          id="terms"
                          checked={acceptTerms}
                          onCheckedChange={(checked) => setAcceptTerms(checked === true)}
                        />
                        <Label htmlFor="terms" className="text-sm">
                          Am citit și sunt de acord cu{" "}
                          <Link href="/termeni" className="text-primary hover:underline">
                            Termenii și Condițiile
                          </Link>{" "}
                          și{" "}
                          <Link href="/confidentialitate" className="text-primary hover:underline">
                            Politica de Confidențialitate
                          </Link>
                        </Label>
                      </div>
                    </div>

                    <Button
                      type="submit"
                      className="w-full gradient-bg hover:opacity-90 py-6 text-base font-medium rounded-md"
                      disabled={isSubmitting || !acceptTerms}
                    >
                      {isSubmitting ? "Se procesează..." : paymentMethod === "pay_on_site" ? "Confirmă rezervarea" : "Continuă spre plată"}
                    </Button>
                  </div>
                </form>
                {/* Mobile Order Summary - visible only on mobile */}
                <div className="lg:hidden bg-gray-50 rounded-xl p-6 mt-6 mb-6">
                  <h2 className="text-lg font-bold mb-4">Sumar comandă</h2>
                  {reservationData && (
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Număr înmatriculare:</span>
                        <span className="font-medium">{reservationData.licensePlate}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Data intrare:</span>
                        <span className="font-medium">
                          {new Date(reservationData.startDate).toLocaleDateString("ro-RO").replace(/\./g, '/')} {reservationData.startTime}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Data ieșire:</span>
                        <span className="font-medium">
                          {new Date(reservationData.endDate).toLocaleDateString("ro-RO").replace(/\./g, '/')} {reservationData.endTime}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Durată:</span>
                        <span className="font-medium">{reservationData.duration}</span>
                      </div>
                      <div className="pt-4 border-t border-gray-200">
                        <div className="flex justify-between items-center">
                          <span className="text-gray-600">Preț:</span>
                          <span className="font-medium">{reservationData.price} RON</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="bg-primary/5 rounded-xl p-4 mt-6">
                  <h2 className="text-lg font-bold mb-2 flex items-center">
                    <Info className="h-5 w-5 mr-2 text-primary" />
                    PARCARE AUTOTURISM
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <ul className="space-y-2 text-sm">
                      <li className="flex items-start">
                        <span className="text-primary mr-2">•</span>
                        <span>ASFALTATĂ</span>
                      </li>
                      <li className="flex items-start">
                        <span className="text-primary mr-2">•</span>
                        <span>Spațiu de parcare suficient și bine organizat</span>
                      </li>
                      <li className="flex items-start">
                        <span className="text-primary mr-2">•</span>
                        <span>Supraveghere video 24/7</span>
                      </li>
                      <li className="flex items-start">
                        <span className="text-primary mr-2">•</span>
                        <span>Transfer gratuit la aeroport</span>
                      </li>
                    </ul>
                    <ul className="space-y-2 text-sm">
                      <li className="flex items-start">
                        <span className="text-primary mr-2">•</span>
                        <span>Infrastructură de înaltă calitate</span>
                      </li>
                      <li className="flex items-start">
                        <span className="text-primary mr-2">•</span>
                        <span>Acces direct din DN1</span>
                      </li>
                      <li className="flex items-start">
                        <span className="text-primary mr-2">•</span>
                        <span>Parcare împrejmuită cu gard</span>
                      </li>
                      <li className="flex items-start">
                        <span className="text-primary mr-2">•</span>
                        <span>Iluminat STÂLPI DE ILUMINARE ELECTRICĂ</span>
                      </li>
                    </ul>
                  </div>

                  <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-start">
                    <AlertCircle className="h-5 w-5 text-yellow-600 mr-2 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-yellow-800">
                      Anularea rezervărilor de parcare făcute cu minim 24 de ore înainte de data și ora intrării în
                      parcare!
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Right column - Order summary */}
          <div className="hidden lg:block lg:w-[400px]">
            <div className="bg-gray-50 rounded-xl p-6 sticky top-6">
              <h2 className="text-lg font-bold mb-4">Sumar comandă</h2>
              {reservationData && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Număr înmatriculare:</span>
                    <span className="font-medium">{reservationData.licensePlate}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Data intrare:</span>
                    <span className="font-medium">
                      {new Date(reservationData.startDate).toLocaleDateString("ro-RO").replace(/\./g, '/')} {reservationData.startTime}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Data ieșire:</span>
                    <span className="font-medium">
                      {new Date(reservationData.endDate).toLocaleDateString("ro-RO").replace(/\./g, '/')} {reservationData.endTime}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Durată:</span>
                    <span className="font-medium">{reservationData.duration}</span>
                  </div>
                  <div className="pt-4 border-t border-gray-200">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Preț original:</span>
                        <span className="font-medium">{reservationData.price} RON</span>
                      </div>
                      {calculateDiscount() > 0 && (
                        <div className="flex justify-between items-center">
                          <span className="text-green-600">Reducere (10%):</span>
                          <span className="font-medium text-green-600">-{calculateDiscount()} RON</span>
                        </div>
                      )}
                      <div className="flex justify-between items-center pt-2 border-t border-gray-200">
                        <span className="text-lg font-bold">Total de plată:</span>
                        <span className="text-lg font-bold text-primary">{calculateTotal()} RON</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
