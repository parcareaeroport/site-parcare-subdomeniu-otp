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
      // JetForm / JetWoo în WooCommerce trimite detaliile formularului în meta._jf_wc_details.form_data
      const jfFromMeta =
        body &&
        typeof body === "object" &&
        body.meta &&
        typeof body.meta === "object" &&
        body.meta._jf_wc_details &&
        typeof body.meta._jf_wc_details === "object"
          ? body.meta._jf_wc_details
          : undefined;
      const jfFromRoot =
        body &&
        typeof body === "object" &&
        body._jf_wc_details &&
        typeof body._jf_wc_details === "object"
          ? body._jf_wc_details
          : undefined;
      const jfSource = jfFromMeta || jfFromRoot || {};
      const formDataKeys =
        jfSource &&
        typeof jfSource === "object" &&
        jfSource.form_data &&
        typeof jfSource.form_data === "object"
          ? Object.keys(jfSource.form_data)
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

    // 2) Extragem datele JetForm/JetWoo din meta._jf_wc_details.form_data (sau fallback din rădăcină)
    const jfDetails =
      body?.meta?._jf_wc_details ||
      body?._jf_wc_details ||
      {};
    const ro = jfDetails.form_data || {};

    console.log(
      `[WP-CARD][${reqId}] Jet form_data keys:`,
      ro && typeof ro === "object" ? Object.keys(ro) : []
    );

    const range = parseRoDateRange(ro.data_intrare_iesire);

    // IMPORTANT:
    // This endpoint is ONLY for card payments. Even if WP/JET metadata is inconsistent/missing,
    // we must always mark the booking as PAID so it shows "Achitat" in admin and triggers QR email sending.
    // (WooCommerce/Jet can omit `metoda_de_plata` or use different keys.)
    const roPayment = ro.metoda_de_plata;
    const wcPaymentMethod = typeof body?.payment_method === "string" ? body.payment_method : "";
    const resolvedPaymentMethod: "card" = "card";
    if (roPayment && roPayment !== "2") {
      console.warn(
        `[WP-CARD][${reqId}] metoda_de_plata=${roPayment} (expected "2" for card). Forcing paymentMethod=card for wp-card-booking endpoint.`
      );
    }
    if (wcPaymentMethod && wcPaymentMethod !== "netopiapayments") {
      console.warn(
        `[WP-CARD][${reqId}] payment_method=${wcPaymentMethod} (expected "netopiapayments"). Forcing paymentMethod=card for wp-card-booking endpoint.`
      );
    }

    // Zilele și sumele din sumar
    const resolvedDays =
      ro.numar_de_zile_sumar !== undefined
        ? parseInt(String(ro.numar_de_zile_sumar), 10) || undefined
        : undefined;

    // Pentru card: folosim prioritar pret_total_sumar, apoi plata_online_cu_cardul_sumar,
    // iar dacă lipsesc (sau Jet nu le trimite), folosim total-ul comenzii WooCommerce.
    const resolvedAmountRaw =
      ro.pret_total_sumar ??
      ro.plata_online_cu_cardul_sumar ??
      ro.plata_cash_card_la_parcare_sumar ??
      body?.total;

    // chei obligatorii mapate
    // 2.1) Fallback: unele integrări trimit direct cheile standard la root (licensePlate/startDate/...)
    const rootLicensePlateRaw =
      body?.licensePlate ?? body?.license_plate ?? body?.plate ?? undefined;
    const rootStartDate = body?.startDate ?? body?.start_date ?? undefined;
    const rootEndDate = body?.endDate ?? body?.end_date ?? undefined;
    const rootStartTime = body?.startTime ?? body?.start_time ?? undefined;
    const rootEndTime = body?.endTime ?? body?.end_time ?? undefined;

    const licensePlate =
      ro.numar_inmatriculare
        ? normalizeLicensePlate(String(ro.numar_inmatriculare))
        : rootLicensePlateRaw
          ? normalizeLicensePlate(String(rootLicensePlateRaw))
          : undefined;
    const startDate = range.start ?? (rootStartDate ? String(rootStartDate) : undefined);
    const endDate = range.end ?? (rootEndDate ? String(rootEndDate) : undefined);
    const startTime = (ro.ora_intrare || undefined) ?? (rootStartTime ? String(rootStartTime) : undefined);
    const endTime = (ro.ora_iesire || undefined) ?? (rootEndTime ? String(rootEndTime) : undefined);

    const mappedSource =
      ro && typeof ro === "object" && Object.keys(ro).length > 0
        ? "jet_form_data"
        : "root_standard_keys";

    console.log(`[WP-CARD][${reqId}] Mapped input → standard (${mappedSource}):`, {
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

    const firstName = ro.prenume || body?.billing?.first_name || "";
    const lastName = ro.nume || body?.billing?.last_name || "";
    const clientName = `${firstName} ${lastName}`.trim() || undefined;

    if (clientName) {
      fd.append("clientName", clientName);
    }
    if (firstName) {
      fd.append("clientTitle", String(firstName));
    }

    const email =
      ro.e_mail ||
      ro.email ||
      ro.adresa_email ||
      body?.email ||
      body?.billing?.email ||
      body?.customer?.email ||
      undefined;
    const phone =
      ro.telefon ||
      ro.phone ||
      body?.billing?.phone ||
      body?.customer?.phone ||
      undefined;
    const numberOfPersons =
      ro.numar_persoane !== undefined
        ? parseInt(String(ro.numar_persoane), 10) || 1
        : 1;

    // Rezolvăm statusul plății și sursa (FORCED: card bookings are always paid on this endpoint)
    const isCard = true;
    const resolvedSource: "webhook" = "webhook";
    const resolvedPaymentStatus: PaymentStatus = "paid";

    // Email flow note (actual send happens inside createBookingWithFirestore via /api/send-confirmation-email)
    console.log(`[WP-CARD][${reqId}] Email flow: if Multipark returns bookingNumber AND email exists, we will send EMAIL WITH QR via /api/send-confirmation-email. email=${email ? "present" : "missing"}`);

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
      // WP/WooCommerce flow: T&C must always be treated as accepted for bookings created through this endpoint
      termsAccepted: true,
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
    try {
      const debugLogs: string[] = Array.isArray((result as any)?.debugLogs) ? (result as any).debugLogs : [];
      const emailSent = debugLogs.some((l) => typeof l === "string" && l.includes("✅ Email sent successfully"));
      const emailAttempted = debugLogs.some((l) => typeof l === "string" && l.includes("📧 Starting email processing"));
      const bookingNumber = (result as any)?.bookingNumber;
      console.log(`[WP-CARD][${reqId}] Email summary: attempted=${emailAttempted}, sent=${emailSent}, bookingNumber=${bookingNumber ?? "undefined"}`);
    } catch (e) {
      console.warn(`[WP-CARD][${reqId}] Could not compute email summary from result.debugLogs`, e);
    }

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


