import Stripe from 'stripe';

// Define CompleteBookingData interface locally
interface CompleteBookingData {
  id: string;
  email: string;
  name: string;
  phone: string;
  totalCost: number;
  startDate: string;
  endDate: string;
  location: string;
  parkingSpot: string;
  billingType: 'individual' | 'corporate';
  company?: string;
  companyVAT?: string;
  companyReg?: string;
  companyAddress?: string;
  stripeCustomerId?: string;
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-05-28.basil',
});

interface InvoiceGenerationResult {
  success: boolean;
  invoiceId?: string;
  invoiceUrl?: string;
  error?: string;
}

export async function generateStripeInvoice(
  bookingData: CompleteBookingData
): Promise<InvoiceGenerationResult> {
  try {
    console.log('🧾 Generând factură Stripe pentru booking:', bookingData.id);

    // 1. Găsește sau creează clientul
    let customer: Stripe.Customer;
    
    if (bookingData.stripeCustomerId) {
      customer = await stripe.customers.retrieve(bookingData.stripeCustomerId) as Stripe.Customer;
    } else {
      // Creează customer nou cu date complete
      const customerData: Stripe.CustomerCreateParams = {
        email: bookingData.email,
        name: bookingData.billingType === 'corporate' 
          ? bookingData.company || bookingData.name 
          : bookingData.name,
        phone: bookingData.phone,
        metadata: {
          bookingId: bookingData.id,
          billingType: bookingData.billingType,
        }
      };

      // Pentru clienți corporativi, adaugă informațiile companiei
      if (bookingData.billingType === 'corporate') {
        customerData.description = `Companie: ${bookingData.company}`;
        customerData.metadata = {
          ...customerData.metadata,
          company: bookingData.company || '',
          companyVAT: bookingData.companyVAT || '',
          companyReg: bookingData.companyReg || '',
          companyAddress: bookingData.companyAddress || '',
        };
      }

      customer = await stripe.customers.create(customerData);
    }

    // 2. Creează factura cu setările pentru România
    const invoice = await stripe.invoices.create({
      customer: customer.id,
      collection_method: 'send_invoice',
      days_until_due: 30,
      currency: 'ron',
      
      // Informații obligatorii pentru România
      metadata: {
        bookingId: bookingData.id,
        billingType: bookingData.billingType,
        // Date obligatorii pentru facturare în România
        companyInfo: 'SC SITE PARCARI SRL - CUI: RO12345678 - Reg. Com.: J40/1234/2024',
        vatRate: '19',
        // Pentru clienți corporativi
        ...(bookingData.billingType === 'corporate' && {
          clientCompany: bookingData.company,
          clientVAT: bookingData.companyVAT,
          clientReg: bookingData.companyReg,
          clientAddress: bookingData.companyAddress,
        })
      },

      // Personalizare factură
      custom_fields: [
        {
          name: 'Număr rezervare',
          value: bookingData.id,
        },
        {
          name: 'Loc de parcare',
          value: `${bookingData.location} - ${bookingData.parkingSpot}`,
        },
        {
          name: 'Perioada',
          value: `${new Date(bookingData.startDate).toLocaleDateString('ro-RO')} - ${new Date(bookingData.endDate).toLocaleDateString('ro-RO')}`,
        }
      ],

      // Footer legal pentru România
      footer: `
Factură emisă conform legislației fiscale românești.
TVA 19% inclusă conform art. 134 din Codul Fiscal.
Plata se poate efectua prin transfer bancar la IBAN: RO49RNCB0000123456789012
      `.trim(),

      // Auto-finalizare după creare
      auto_advance: true,
    });

    // 3. Calculează prețul cu TVA 19%
    const basePrice = Math.round(bookingData.totalCost * 100); // În bani (cents/bani)
    const priceWithoutVAT = Math.round(basePrice / 1.19); // Preț fără TVA
    const vatAmount = basePrice - priceWithoutVAT; // TVA 19%

    // 4. Adaugă item-ul principal
    await stripe.invoiceItems.create({
      customer: customer.id,
      invoice: invoice.id,
      amount: priceWithoutVAT,
      currency: 'ron',
      description: `Rezervare parcare - ${bookingData.location}`,
      metadata: {
        bookingId: bookingData.id,
        startDate: bookingData.startDate,
        endDate: bookingData.endDate,
        location: bookingData.location,
        parkingSpot: bookingData.parkingSpot,
      },
      // Aplicare TVA 19%
      tax_rates: await getTaxRateForRomania(),
    });

    // 5. Verifică că factura are ID și finalizează
    if (!invoice.id || typeof invoice.id !== 'string') {
      throw new Error('Factura creată nu are ID valid');
    }
    
    const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id);
    
    // 6. Trimite factura prin email
    await stripe.invoices.sendInvoice(invoice.id);

    console.log('✅ Factură Stripe generată și trimisă:', {
      invoiceId: finalizedInvoice.id,
      invoiceNumber: finalizedInvoice.number,
      invoiceUrl: finalizedInvoice.hosted_invoice_url,
      pdfUrl: finalizedInvoice.invoice_pdf,
    });

    return {
      success: true,
      invoiceId: finalizedInvoice.id,
      invoiceUrl: finalizedInvoice.hosted_invoice_url || undefined,
    };

  } catch (error) {
    console.error('❌ Eroare la generarea facturii Stripe:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Eroare necunoscută',
    };
  }
}

// Funcție helper pentru rata de TVA în România
async function getTaxRateForRomania(): Promise<string[]> {
  try {
    // Încearcă să găsești rata de TVA existentă pentru România
    const taxRates = await stripe.taxRates.list({
      active: true,
      limit: 10,
    });

    const romanianTaxRate = taxRates.data.find(
      rate => rate.display_name === 'TVA România' && rate.percentage === 19
    );

    if (romanianTaxRate) {
      return [romanianTaxRate.id];
    }

    // Creează rata de TVA pentru România dacă nu există
    const newTaxRate = await stripe.taxRates.create({
      display_name: 'TVA România',
      description: 'Taxa pe valoarea adăugată pentru România (19%)',
      jurisdiction: 'RO',
      percentage: 19,
      inclusive: false,
    });

    return [newTaxRate.id];
  } catch (error) {
    console.error('Eroare la crearea ratei de TVA:', error);
    return [];
  }
}

// Funcție pentru a obține detaliile facturii
export async function getInvoiceDetails(invoiceId: string) {
  try {
    const invoice = await stripe.invoices.retrieve(invoiceId, {
      expand: ['customer', 'lines.data.price', 'payment_intent'],
    });

    return {
      success: true,
      invoice,
    };
  } catch (error) {
    console.error('Eroare la obținerea detaliilor facturii:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Eroare necunoscută',
    };
  }
}

// Funcție pentru a marca factura ca plătită (pentru plăți externe)
export async function markInvoiceAsPaid(invoiceId: string) {
  try {
    const invoice = await stripe.invoices.pay(invoiceId, {
      paid_out_of_band: true,
    });

    return {
      success: true,
      invoice,
    };
  } catch (error) {
    console.error('Eroare la marcarea facturii ca plătită:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Eroare necunoscută',
    };
  }
} 