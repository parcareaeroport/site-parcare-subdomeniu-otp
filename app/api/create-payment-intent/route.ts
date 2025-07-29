import { type NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { normalizeLicensePlate } from "@/lib/utils"

// Inițializăm clientul Stripe cu cheia secretă
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-05-28.basil",
})

export async function POST(request: NextRequest) {
  try {
    // Verificăm dacă avem cheia Stripe
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: "Stripe secret key not configured" }, { status: 500 })
    }

    const body = await request.json()
    const { amount, bookingData, customerInfo, orderId } = body

    // Validăm datele primite
    if (!amount || !bookingData || !customerInfo || !orderId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    // Pregătim metadata pentru PaymentIntent
    const metadata: Record<string, string> = {
      orderId,
      customerName: `${customerInfo.firstName} ${customerInfo.lastName}`,
      customerEmail: customerInfo.email,
      customerPhone: customerInfo.phone || "",
      licensePlate: normalizeLicensePlate(bookingData.licensePlate), // Normalizare pentru siguranță
      startDate: bookingData.startDate,
      endDate: bookingData.endDate,
      sourceUrl: process.env.NEXT_PUBLIC_APP_URL || "", // Adăugăm sursa pentru identificare
    }

    // Adăugăm datele de facturare dacă sunt disponibile
    if (customerInfo.address) metadata.address = customerInfo.address
    if (customerInfo.city) metadata.city = customerInfo.city
    if (customerInfo.county) metadata.county = customerInfo.county
    if (customerInfo.postalCode) metadata.postalCode = customerInfo.postalCode
    if (customerInfo.country) metadata.country = customerInfo.country
    if (customerInfo.company) metadata.company = customerInfo.company
    if (customerInfo.companyVAT) metadata.companyVAT = customerInfo.companyVAT
    if (customerInfo.companyReg) metadata.companyReg = customerInfo.companyReg
    if (customerInfo.companyAddress) metadata.companyAddress = customerInfo.companyAddress
    if (customerInfo.notes) metadata.orderNotes = customerInfo.notes
    if (customerInfo.needInvoice !== undefined) metadata.needInvoice = customerInfo.needInvoice.toString()
    if (customerInfo.termsAccepted !== undefined) metadata.termsAccepted = customerInfo.termsAccepted.toString()

    // Creăm un obiect de plată în Stripe
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Stripe folosește cenți/bani, nu lei/euro
      currency: "ron",
      payment_method_types: ["card"], // Specificați explicit 'card'
      metadata,
    })

    // Returnăm client_secret pentru a putea finaliza plata pe client
    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
    })
  } catch (error: any) {
    console.error("Error creating payment intent:", error)
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
}

// Adaugă și alte metode pentru a evita eroarea INVALID_REQUEST_METHOD
export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 })
}

export async function PUT() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 })
}

export async function DELETE() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 })
}
