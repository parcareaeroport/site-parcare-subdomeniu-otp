import { NextRequest, NextResponse } from "next/server";
import { createBookingWithFirestore } from "@/app/actions/booking-actions";
import { normalizeLicensePlate } from "@/lib/utils";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

type PaymentStatus = "paid" | "pending" | "n/a";

const corsHeaders = {
  "Access-Control-Allow-Origin": process.env.WP_ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Auth-Token, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

// Util: parse dd.MM.yyyy -> yyyy-MM-dd
function parseRoDate(d?: string): string | undefined {
  if (!d) return undefined;
  const m = d.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return undefined;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

// Util: split "dd.MM.yyyy - dd.MM.yyyy"
function parseRoDateRange(
  r?: string
): { start?: string; end?: string } {
  if (!r) return { start: undefined, end: undefined };
  const parts = r.split("-").map((s) => s.trim());
  if (parts.length !== 2) return { start: undefined, end: undefined };
  return {
    start: parseRoDate(parts[0]),
    end: parseRoDate(parts[1]),
  };
}

export async function POST(request: NextRequest) {
  const reqId = `wp-card-booking-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  console.log(`[WP-CARD][${reqId}] New POST request received.`);

  try {
    // 1) Auth opțional prin token (același mecanism ca la wp-booking)
    const expectedToken = process.env.EXTERNAL_BOOKING_TOKEN;
    if (expectedToken) {
      const providedToken =
        request.headers.get("x-auth-token") ||
        request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

      if (!providedToken || providedToken !== expectedToken) {
        console.warn(
          `[WP-CARD][${reqId}] Invalid or missing auth token.`
        );
        return NextResponse.json(
          { success: false, error: "Unauthorized" },
          { status: 401, headers: corsHeaders }
        );
      }
    }

    const contentType = request.headers.get("content-type") || "";
    console.log(
      `[WP-CARD][${reqId}] Content-Type: ${contentType}`
    );

    // Ne așteptăm la JSON din WooCommerce webhook
    let body: any = null;
    try {
      body = await request.json();
      console.log(
        `[WP-CARD][${reqId}] Raw JSON body from WP/WC:`,
        body
      );
      console.log(
        `[WP-CARD][${reqId}] Top-level keys:`,
        body && typeof body === "object" ? Object.keys(body) : []
      );
    } catch (e) {
      console.warn(
        `[WP-CARD][${reqId}] Could not parse JSON body:`,
        e
      );
      body = {};
    }

    // Persistăm un log minimal în Firestore (fără PII, doar chei)
    try {
      const topLevelKeys =
        body && typeof body === "object" ? Object.keys(body) : [];
      const formDataKeys =
        body &&
        typeof body === "object" &&
        body._jf_wc_details &&
        body._jf_wc_details.form_data &&
        typeof body._jf_wc_details.form_data === "object"
          ? Object.keys(body._jf_wc_details.form_data)
          : [];

      await addDoc(collection(db, "webhook_logs"), {
        source: "wp-card-booking",
        reqId,
        contentType,
        keys: topLevelKeys,
        formDataKeys,
        receivedAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn(
        `[WP-CARD][${reqId}] Failed to persist webhook keys log (json):`,
        e
      );
    }

    // 2) Extragem datele JetForm/JetWoo din _jf_wc_details.form_data
    const jfDetails = body?._jf_wc_details || {};
    const ro = jfDetails.form_data || {};

    console.log(
      `[WP-CARD][${reqId}] Jet form_data keys:`,
      ro && typeof ro === "object" ? Object.keys(ro) : []
    );

    const range = parseRoDateRange(ro.data_intrare_iesire);

    // Determinăm metoda de plată din form_data.metoda_de_plata
    // Convenție:
    //  - "1" = plata cash/card la parcare (pay_on_site)
    //  - "2" = plata online cu cardul
    const roPayment = ro.metoda_de_plata;
    const resolvedPaymentMethod =
      roPayment === "2"
        ? "card"
        : roPayment === "1"
        ? "pay_on_site"
        : undefined;

    if (resolvedPaymentMethod !== "card") {
      console.warn(
        `[WP-CARD][${reqId}] Payment method is not 'card' (metoda_de_plata=${roPayment}). This endpoint is intended for card payments.`
      );
    }

    // Zilele și sumele din sumar
    const resolvedDays =
      ro.numar_de_zile_sumar !== undefined
        ? parseInt(String(ro.numar_de_zile_sumar), 10) || undefined
        : undefined;

    // Pentru card: folosim prioritar pret_total_sumar, apoi plata_online_cu_cardul_sumar
    const resolvedAmountRaw =
      ro.pret_total_sumar ??
      ro.plata_online_cu_cardul_sumar ??
      ro.plata_cash_card_la_parcare_sumar;

    // chei obligatorii mapate
    const licensePlate = ro.numar_inmatriculare
      ? normalizeLicensePlate(String(ro.numar_inmatriculare))
      : undefined;
    const startDate = range.start;
    const endDate = range.end;
    const startTime = ro.ora_intrare || undefined;
    const endTime = ro.ora_iesire || undefined;

    console.log(`[WP-CARD][${reqId}] Mapped RO → standard:`, {
      licensePlate,
      startDate,
      endDate,
      startTime,
      endTime,
      resolvedPaymentMethod,
      resolvedDays,
      resolvedAmountRaw,
    });

    if (!licensePlate || !startDate || !endDate || !startTime || !endTime) {
      console.error(
        `[WP-CARD][${reqId}] Missing required fields: licensePlate=${licensePlate}, startDate=${startDate}, startTime=${startTime}, endDate=${endDate}, endTime=${endTime}`
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "Missing required fields: licensePlate, startDate, startTime, endDate, endTime",
        },
        { status: 400, headers: corsHeaders }
      );
    }

    // 3) Pregătim FormData pentru fluxul existent (Multipark + Firestore + Oblio)
    const fd = new FormData();
    fd.append("licensePlate", String(licensePlate));
    fd.append("startDate", String(startDate));
    fd.append("startTime", String(startTime));
    fd.append("endDate", String(endDate));
    fd.append("endTime", String(endTime));

    const firstName = ro.prenume || "";
    const lastName = ro.nume || "";
    const clientName = `${firstName} ${lastName}`.trim() || undefined;

    if (clientName) {
      fd.append("clientName", clientName);
    }
    if (firstName) {
      fd.append("clientTitle", String(firstName));
    }

    const email = ro.e_mail || undefined;
    const phone = ro.telefon || undefined;
    const numberOfPersons =
      ro.numar_persoane !== undefined
        ? parseInt(String(ro.numar_persoane), 10) || 1
        : 1;

    // Rezolvăm statusul plății și sursa
    const isCard = resolvedPaymentMethod === "card";
    const resolvedSource: "webhook" = "webhook";
    const resolvedPaymentStatus: PaymentStatus = isCard ? "paid" : "pending";

    // Convertim amount în number (dacă este posibil)
    let amount: number | undefined = undefined;
    if (resolvedAmountRaw !== undefined) {
      const parsed = parseFloat(String(resolvedAmountRaw));
      if (!Number.isNaN(parsed) && parsed > 0) {
        amount = parsed;
      }
    }

    console.log(`[WP-CARD][${reqId}] Final booking core data:`, {
      licensePlate,
      startDate,
      startTime,
      endDate,
      endTime,
      clientName,
      email,
      phone,
      numberOfPersons,
      resolvedPaymentMethod,
      resolvedSource,
      resolvedPaymentStatus,
      days: resolvedDays,
      amount,
    });

    // 4) Apelăm fluxul standard de creare rezervare
    const result = await createBookingWithFirestore(fd, {
      clientEmail: email,
      clientPhone: phone,
      numberOfPersons,
      paymentStatus: resolvedPaymentStatus,
      source: resolvedSource,
      // adresă & facturare
      address: ro.adresa || undefined,
      city: ro.oras || undefined,
      county: ro.judet || undefined,
      postalCode: undefined,
      country: ro.tara || undefined,
      needInvoice: !!ro.doresc_factura_pentru_persoana_juridica,
      company: ro.denumire_firma || undefined,
      companyVAT: ro.cui_cif || undefined,
      companyReg: ro.numar_registrul_comertului || undefined,
      companyAddress: ro.adresa_firma || undefined,
      // termeni
      termsAccepted: !!ro.gdpr,
      // card extras
      amount,
      days: resolvedDays,
      paymentIntentId: undefined,
      orderNotes: ro.observatii_rezervare || undefined,
    });

    console.log(
      `[WP-CARD][${reqId}] Firestore + Multipark + Oblio booking result:`,
      result
    );

    return NextResponse.json(result, {
      status: 200,
      headers: corsHeaders,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";

    console.error(
      `[WP-CARD][${reqId}] ERROR while handling card booking:`,
      error
    );

    return NextResponse.json(
      { success: false, error: message },
      { status: 500, headers: corsHeaders }
    );
  }
}


