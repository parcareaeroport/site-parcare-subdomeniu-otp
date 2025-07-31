interface OblioInvoiceData {
  bookingId: string;
  clientName: string;
  clientEmail: string;
  clientPhone?: string;
  licensePlate: string;
  startDate: string;
  endDate: string;
  location: string;
  parkingSpot: string;
  totalCost: number;
  billingType: 'individual' | 'corporate';
  company?: string;
  companyVAT?: string;
  companyReg?: string;
  companyAddress?: string;
  // Date adresă client individual
  clientAddress?: string;
  clientCity?: string;
  clientCounty?: string;
  clientCountry?: string;
}

interface OblioConfig {
  clientId: string; // email de logare Oblio
  clientSecret: string; // token secret din setări
  companyCif: string; // CIF-ul companiei tale
  defaultSeries: string; // seria de facturi (ex: "FCT")
}

interface OblioAPIResponse {
  status: number;
  statusMessage: string;
  data: {
    seriesName: string;
    number: string;
    link: string;
  };
}

class OblioInvoiceService {
  private config: OblioConfig;
  private accessToken: string | null = null;
  private tokenExpires: number = 0;

  constructor(config: OblioConfig) {
    this.config = config;
  }

  // 1. Autentificare și obținere token
  private async authenticate(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpires) {
      console.log('🔄 Using cached Oblio token');
      return this.accessToken;
    }

    try {
      console.log('🔐 Attempting Oblio authentication...');
      console.log('🔐 Client ID (email):', this.config.clientId ? 'SET' : 'NOT SET');
      console.log('🔐 Client Secret:', this.config.clientSecret ? `SET (${this.config.clientSecret.length} chars)` : 'NOT SET');
      console.log('🔐 Company CIF:', this.config.companyCif ? 'SET' : 'NOT SET');
      
      const authPayload = {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      };
      
      console.log('🔐 Auth payload prepared, sending request to Oblio...');
      
      const response = await fetch('https://www.oblio.eu/api/authorize/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(authPayload),
      });

      console.log(`🔐 Oblio auth response status: ${response.status}`);
      console.log(`🔐 Oblio auth response statusText: ${response.statusText}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Oblio auth failed - Response body:', errorText);
        throw new Error(`Oblio authentication failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('✅ Oblio auth successful, token received');
      console.log('🔐 Token expires in:', data.expires_in, 'seconds');
      
      this.accessToken = data.access_token;
      this.tokenExpires = Date.now() + (data.expires_in * 1000) - 60000; // -1 min pentru siguranță

      return this.accessToken!;
    } catch (error) {
      console.error('❌ Oblio authentication error:', error);
      // Resetează cache-ul în caz de eroare
      this.accessToken = null;
      this.tokenExpires = 0;
      throw error;
    }
  }

  // 2. Generare factură în Oblio
  async generateInvoice(invoiceData: OblioInvoiceData): Promise<{ success: boolean; invoiceNumber?: string; invoiceUrl?: string; error?: string }> {
    try {
      console.log('🧾 Generând factură Oblio pentru rezervarea:', invoiceData.bookingId);
      console.log('📧 Oblio va trimite automat factura pe email:', invoiceData.clientEmail);

      const token = await this.authenticate();

      // Pregătire date pentru Oblio API
      const oblioInvoiceData = this.prepareInvoiceData(invoiceData);

      const response = await fetch('https://www.oblio.eu/api/docs/invoice', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(oblioInvoiceData),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Oblio API error: ${response.status} - ${errorText}`);
      }

      const result: OblioAPIResponse = await response.json();

      if (result.status === 200) {
        console.log('✅ Factură Oblio generată cu succes:', {
          seria: result.data.seriesName,
          numar: result.data.number,
          link: result.data.link,
        });
        console.log('📧 Email cu factura trimis automat către:', invoiceData.clientEmail);

        return {
          success: true,
          invoiceNumber: `${result.data.seriesName} ${result.data.number}`,
          invoiceUrl: result.data.link,
        };
      } else {
        throw new Error(`Oblio returned error: ${result.statusMessage}`);
      }

    } catch (error) {
      console.error('❌ Eroare la generarea facturii Oblio:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Eroare necunoscută',
      };
    }
  }

  // 3. Pregătire date pentru API Oblio
  private prepareInvoiceData(invoiceData: OblioInvoiceData) {
    // Calculare preț fără TVA (19% este inclus în totalCost)
    const totalWithVAT = invoiceData.totalCost;
    const priceWithoutVAT = Math.round((totalWithVAT / 1.19) * 100) / 100;

    const baseInvoiceData = {
      cif: this.config.companyCif,
      client: this.prepareClientData(invoiceData),
      issueDate: new Date().toISOString().split('T')[0], // YYYY-MM-DD
      seriesName: this.config.defaultSeries,
      language: 'RO',
      precision: 2,
      currency: 'RON',
      sendEmail: 1, // Trimite automat factura pe email
      products: [
        {
          name: `Servicii parcare autovehicul ${invoiceData.licensePlate}`,
          description: `Rezervare parcare #${invoiceData.bookingId}\nPerioda: ${invoiceData.startDate} - ${invoiceData.endDate}\nLocația: ${invoiceData.location} - ${invoiceData.parkingSpot}`,
          price: priceWithoutVAT,
          measuringUnit: 'bucată',
          vatName: 'Normala',
          vatPercentage: 19,
          vatIncluded: false,
          quantity: 1,
          productType: 'Serviciu',
        },
      ],
      mentions: `Factură generată automat pentru rezervarea de parcare #${invoiceData.bookingId}. Plata a fost procesată prin Stripe.`,
      internalNote: `Booking ID: ${invoiceData.bookingId} | Stripe Payment`,
      collect: {
        type: 'Card',
        documentNumber: `STRIPE-${invoiceData.bookingId}`,
        value: totalWithVAT,
        issueDate: new Date().toISOString().split('T')[0],
        mentions: 'Plată procesată prin Stripe',
      },
    };

    return baseInvoiceData;
  }

  // 4. Pregătire date client
  private prepareClientData(invoiceData: OblioInvoiceData) {
    if (invoiceData.billingType === 'corporate' && invoiceData.company) {
      // Client corporativ
      return {
        cif: invoiceData.companyVAT || '',
        name: invoiceData.company,
        rc: invoiceData.companyReg || '',
        address: invoiceData.companyAddress || '',
        email: invoiceData.clientEmail,
        phone: invoiceData.clientPhone || '',
        contact: invoiceData.clientName,
        vatPayer: true,
        save: 1, // Salvează clientul în baza de date Oblio
      };
    } else {
      // Client individual - trimitem câmpurile separate pentru a fi procesate corect de Oblio
      return {
        name: invoiceData.clientName,
        address: invoiceData.clientAddress || '', // Adresa principală (strada + numărul)
        state: invoiceData.clientCounty || '', // Județul
        city: invoiceData.clientCity || '', // Orașul/Localitatea
        country: invoiceData.clientCountry || 'Romania', // Țara (default Romania)
        email: invoiceData.clientEmail,
        phone: invoiceData.clientPhone || '',
        vatPayer: false,
        save: 1,
      };
    }
  }

  // 5. Obținere detalii factură
  async getInvoiceDetails(seriesName: string, number: string) {
    try {
      const token = await this.authenticate();

      const response = await fetch(
        `https://www.oblio.eu/api/docs/invoice?cif=${this.config.companyCif}&seriesName=${seriesName}&number=${number}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to get invoice details: ${response.status}`);
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error('Error getting invoice details:', error);
      throw error;
    }
  }
}

// Configurare serviciu pentru Site Parcări
const oblioConfig: OblioConfig = {
  clientId: process.env.OBLIO_EMAIL!,
  clientSecret: process.env.OBLIO_SECRET!,
  companyCif: process.env.OBLIO_CIF!,
  defaultSeries: process.env.OBLIO_SERIES || 'FCT',
};

// Export serviciu configurat
export const oblioService = new OblioInvoiceService(oblioConfig);

// Funcție helper pentru generarea facturilor
export async function generateOblioInvoice(invoiceData: OblioInvoiceData) {
  return await oblioService.generateInvoice(invoiceData);
}

export type { OblioInvoiceData }; 






