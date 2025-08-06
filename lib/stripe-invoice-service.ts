import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-05-28.basil',
})

interface RomanianInvoiceData {
  // Date rezervare
  bookingNumber: string
  licensePlate: string
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  days: number
  
  // Date client
  clientName: string
  clientEmail: string
  clientPhone?: string
  clientAddress?: string
  clientCity?: string
  clientCounty?: string
  clientPostalCode?: string
  
  // Date pentru facturare (opțional - doar pentru persoane juridice)
  company?: string
  companyVAT?: string // CUI/CIF
  companyReg?: string // Număr Registrul Comerțului
  companyAddress?: string
  needInvoice?: boolean
  
  // Date financiare
  subtotal: number // Fără TVA
  tva: number      // TVA 21%
  total: number    // Cu TVA
}

// Informații firmă Site Parcări (trebuie completate cu datele reale)
const COMPANY_INFO = {
  name: "SITE PARCĂRI SRL", // Numele companiei tale
  vatNumber: "RO12345678", // CUI-ul companiei tale
  regNumber: "J40/1234/2024", // Nr. Reg. Com.
  address: "Strada Exemplu, nr. 1, Sector 1, București",
  iban: "RO49AAAA1B31007593840000", // IBAN-ul companiei
  email: "facturi@siteparcari.ro",
  phone: "+40123456789"
}

export async function createStripeInvoiceForBooking(invoiceData: RomanianInvoiceData): Promise<string> {
  try {
    // Determină tipul de client
    const isCompany = invoiceData.needInvoice && invoiceData.company
    
    // 1. Creează customer în Stripe (sau găsește existent)
    const customer = await stripe.customers.create({
      name: isCompany ? invoiceData.company : invoiceData.clientName,
      email: invoiceData.clientEmail,
      phone: invoiceData.clientPhone,
      address: {
        line1: isCompany ? invoiceData.companyAddress : invoiceData.clientAddress,
        city: invoiceData.clientCity,
        state: invoiceData.clientCounty,
        postal_code: invoiceData.clientPostalCode,
        country: 'RO'
      },
      // Metadata pentru tracking
      metadata: {
        booking_number: invoiceData.bookingNumber,
        license_plate: invoiceData.licensePlate,
        customer_type: isCompany ? 'company' : 'individual',
        ...(isCompany && {
          company: invoiceData.company || '',
          vat_number: invoiceData.companyVAT || '',
          reg_number: invoiceData.companyReg || '',
        })
      }
    })

    // 2. Creează invoice item pentru parcarea
    const invoiceItem = await stripe.invoiceItems.create({
      customer: customer.id,
      description: `Servicii parcare ${invoiceData.licensePlate} | ${invoiceData.startDate} ${invoiceData.startTime} - ${invoiceData.endDate} ${invoiceData.endTime} | ${invoiceData.days} ${invoiceData.days === 1 ? 'zi' : 'zile'}`,
      quantity: 1, // Cantitate fixă pentru serviciu complet
      amount: Math.round(invoiceData.subtotal * 100), // Subtotal în cenți (fără TVA)
      currency: 'ron',
      tax_rates: ['txr_romanian_vat'], // Tax rate pentru România 19% (trebuie creat în Stripe)
      metadata: {
        booking_number: invoiceData.bookingNumber,
        service_type: 'parking',
        period_days: invoiceData.days.toString(),
        license_plate: invoiceData.licensePlate,
        location: 'Parcarea Site Parcări'
      }
    })

    // 3. Creează invoice-ul
    // @ts-ignore - TypeScript issue with Stripe types
    const invoice = await stripe.invoices.create({
      customer: customer.id,
      collection_method: 'send_invoice', // Va trimite automat pe email
      days_until_due: 0, // Plata este deja procesată, factura este pentru evidență
      currency: 'ron',
      
      // Metadata pentru cerințele românești
      metadata: {
        invoice_type: isCompany ? 'company' : 'individual',
        booking_number: invoiceData.bookingNumber,
        license_plate: invoiceData.licensePlate,
        payment_status: 'paid', // Plata este deja procesată
        
        // Date furnizor (Site Parcări)
        supplier_name: COMPANY_INFO.name,
        supplier_vat: COMPANY_INFO.vatNumber,
        supplier_reg: COMPANY_INFO.regNumber,
        supplier_address: COMPANY_INFO.address,
        supplier_iban: COMPANY_INFO.iban,
        
        // Date client
        customer_name: isCompany ? invoiceData.company : invoiceData.clientName,
        customer_email: invoiceData.clientEmail,
        customer_address: isCompany ? invoiceData.companyAddress : invoiceData.clientAddress,
        ...(isCompany && {
          customer_company: invoiceData.company,
          customer_vat: invoiceData.companyVAT,
          customer_reg: invoiceData.companyReg,
        })
      },

      // Footer cu informații legale
      footer: `
${COMPANY_INFO.name} | CUI: ${COMPANY_INFO.vatNumber} | Reg. Com.: ${COMPANY_INFO.regNumber}
Adresa: ${COMPANY_INFO.address} | IBAN: ${COMPANY_INFO.iban}
Email: ${COMPANY_INFO.email} | Tel: ${COMPANY_INFO.phone}

Factură fiscală pentru rezervarea #${invoiceData.bookingNumber}
${isCompany ? 'Persoană juridică' : 'Persoană fizică'} | TVA 19% conform legislației române
Plata a fost procesată prin Stripe. Mulțumim pentru încredere!
      `.trim(),

      // Custom fields pentru informații suplimentare
      custom_fields: [
        {
          name: 'Rezervare Nr.',
          value: invoiceData.bookingNumber
        },
        {
          name: 'Autovehicul',
          value: invoiceData.licensePlate
        },
        {
          name: 'Perioada',
          value: `${invoiceData.startDate} ${invoiceData.startTime} - ${invoiceData.endDate} ${invoiceData.endTime}`
        },
        {
          name: 'Durata',
          value: `${invoiceData.days} ${invoiceData.days === 1 ? 'zi' : 'zile'}`
        },
        {
          name: 'Status Plată',
          value: 'PLĂTITĂ - prin Stripe'
        },
        // Câmpuri adiționale pentru persoane juridice
        ...(isCompany ? [
          {
            name: 'Tip Client',
            value: 'PERSOANĂ JURIDICĂ'
          },
          {
            name: 'Denumire Firmă',
            value: invoiceData.company || ''
          },
          {
            name: 'CUI/CIF',
            value: invoiceData.companyVAT || ''
          },
          {
            name: 'Nr. Reg. Com.',
            value: invoiceData.companyReg || ''
          }
        ] : [
          {
            name: 'Tip Client',
            value: 'PERSOANĂ FIZICĂ'
          }
        ])
      ]
    })

    // 4. Finalizează invoice-ul pentru a-l face disponibil
    const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id, {
      auto_advance: false // Nu încerca să colecteze plata - este deja plătită
    })

    // 5. Trimite invoice-ul pe email
    await stripe.invoices.sendInvoice(finalizedInvoice.id)

    console.log(`✅ Factură Stripe generată și trimisă: ${finalizedInvoice.number}`)
    console.log(`📧 Trimisă pe email: ${invoiceData.clientEmail}`)
    console.log(`👤 Client: ${isCompany ? invoiceData.company : invoiceData.clientName}`)
    
    return finalizedInvoice.number || finalizedInvoice.id

  } catch (error) {
    console.error('❌ Eroare la generarea facturii Stripe:', error)
    throw new Error(`Eroare la generarea facturii: ${error instanceof Error ? error.message : 'Eroare necunoscută'}`)
  }
}

// Funcție pentru crearea tax rate-ului român (rulează o singură dată)
export async function createRomanianTaxRate() {
  try {
    const taxRate = await stripe.taxRates.create({
      display_name: 'TVA România',
      description: 'Taxa pe valoarea adăugată România - 21%',
      jurisdiction: 'RO',
              percentage: 21.0,
      inclusive: false, // TVA se adaugă la preț
      country: 'RO',
      metadata: {
        country: 'Romania',
        rate_type: 'VAT'
      }
    })
    
    console.log(`✅ Tax rate român creat: ${taxRate.id}`)
    return taxRate.id
  } catch (error) {
    console.error('❌ Eroare la crearea tax rate:', error)
    throw error
  }
}

// Funcție pentru integrarea cu sistemul existent
export async function generateInvoiceForBooking(bookingData: any) {
  const invoiceData: RomanianInvoiceData = {
    bookingNumber: bookingData.bookingNumber,
    licensePlate: bookingData.licensePlate,
    startDate: bookingData.startDate,
    startTime: bookingData.startTime,
    endDate: bookingData.endDate,
    endTime: bookingData.endTime,
    days: bookingData.days,
    
    clientName: bookingData.clientName,
    clientEmail: bookingData.clientEmail,
    clientPhone: bookingData.clientPhone,
    clientAddress: bookingData.address,
    clientCity: bookingData.city,
    clientCounty: bookingData.county,
    clientPostalCode: bookingData.postalCode,
    
    // Date pentru facturare
    company: bookingData.company,
    companyVAT: bookingData.companyVAT,
    companyReg: bookingData.companyReg,
    companyAddress: bookingData.companyAddress,
    needInvoice: bookingData.needInvoice,
    
    // Calcule financiare
    subtotal: Math.round(bookingData.amount / 1.21 * 100) / 100, // Fără TVA
    tva: Math.round(bookingData.amount * 0.21 / 1.21 * 100) / 100, // TVA 21%
    total: bookingData.amount // Total cu TVA
  }
  
  return await createStripeInvoiceForBooking(invoiceData)
} 