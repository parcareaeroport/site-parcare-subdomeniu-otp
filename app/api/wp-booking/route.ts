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

/**
 * Transformă payload-ul Elementor (application/x-www-form-urlencoded)
 * cu chei de tipul fields[licensePlate][value] într-un obiect JSON simplu.
 */
function mapElementorFlatToJson(
  flat: Record<string, string>,
  reqId: string
) {
  const getField = (id: string): string => {
    return (
      flat[`fields[${id}][value]`] ??
      flat[`fields[${id}][raw_value]`] ??
      ""
    );
  };

  const mapped = {
    // câmpurile care ne interesează pentru rezervare
    licensePlate: getField("licensePlate"),
    startDate: getField("startDate"),
    startTime: getField("startTime"),
    endDate: getField("endDate"),
    endTime: getField("endTime"),

    paymentMethod: getField("paymentMethod"),

    firstName: getField("firstName"),
    lastName: getField("lastName"),
    email: getField("email"),
    phone: getField("phone"),
    numberOfPersons: getField("numberOfPersons"),

    address: getField("address"),
    city: getField("city"),
    county: getField("county"),
    postalCode: getField("postalCode"),
    country: getField("country"),

    needInvoice: !!getField("needInvoice"),
    company: getField("company"),
    companyVAT: getField("companyVAT"),
    companyReg: getField("companyReg"),
    companyAddress: getField("companyAddress"),

    // card extras
    amount: getField("amount"),
    days: getField("days"),
    paymentIntentId: getField("paymentIntentId"),
    orderNotes: getField("orderNotes"),
    acceptTerms: !!getField("acceptTerms"),
  };

  console.log(
    `[WP-BOOKING][${reqId}] Elementor-mapped body (flattened → JSON):`,
    mapped
  );

  return mapped;
}

export async function POST(request: NextRequest) {
  const reqId = `wp-booking-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  console.log(`[WP-BOOKING][${reqId}] New POST request received.`);

  try {
    // 1) Auth opțional prin token
    const expectedToken = process.env.EXTERNAL_BOOKING_TOKEN;
    if (expectedToken) {
      const providedToken =
        request.headers.get("x-auth-token") ||
        request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

      if (!providedToken || providedToken !== expectedToken) {
        console.warn(
          `[WP-BOOKING][${reqId}] Invalid or missing auth token.`
        );
        return NextResponse.json(
          { success: false, error: "Unauthorized" },
          { status: 401, headers: corsHeaders }
        );
      }
    }

    const contentType = request.headers.get("content-type") || "";
    console.log(
      `[WP-BOOKING][${reqId}] Content-Type: ${contentType}`
    );

    let body: any = null;

    // 2) Elementor trimite application/x-www-form-urlencoded
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const text = await request.text();
      const form = new URLSearchParams(text);

      const flat: Record<string, string> = {};
      form.forEach((value, key) => {
        flat[key] = value;
      });

      console.log(
        `[WP-BOOKING][${reqId}] Raw body from WP (flat form):`,
        flat
      );
      console.log(
        `[WP-BOOKING][${reqId}] Incoming keys (flat form):`,
        Object.keys(flat)
      );
      // Persist minimal log with keys only (no PII)
      try {
        await addDoc(collection(db, "webhook_logs"), {
          source: "wp-booking",
          reqId,
          contentType,
          keys: Object.keys(flat),
          receivedAt: serverTimestamp(),
        });
      } catch (e) {
        console.warn(`[WP-BOOKING][${reqId}] Failed to persist webhook keys log (flat):`, e);
      }

      const hasElementorFields = Object.keys(flat).some((k) =>
        k.startsWith("fields[")
      );

      if (hasElementorFields) {
        body = mapElementorFlatToJson(flat, reqId);
      } else {
        console.log(
          `[WP-BOOKING][${reqId}] No fields[...] key pattern found, using flat body as-is.`
        );
        body = flat;
      }
    } else {
      // fallback pentru JSON (dacă vreodată trimiți direct JSON din WP)
      try {
        body = await request.json();
        console.log(
          `[WP-BOOKING][${reqId}] Raw JSON body:`,
          body
        );
        console.log(
          `[WP-BOOKING][${reqId}] Incoming keys (json):`,
          body && typeof body === "object" ? Object.keys(body) : []
        );
        // Persist minimal log with keys only (no PII)
        try {
          await addDoc(collection(db, "webhook_logs"), {
            source: "wp-booking",
            reqId,
            contentType,
            keys: body && typeof body === "object" ? Object.keys(body) : [],
            receivedAt: serverTimestamp(),
          });
        } catch (e) {
          console.warn(`[WP-BOOKING][${reqId}] Failed to persist webhook keys log (json):`, e);
        }
      } catch (e) {
        console.warn(
          `[WP-BOOKING][${reqId}] Could not parse JSON body:`,
          e
        );
        body = {};
      }
    }

    console.log(
      `[WP-BOOKING][${reqId}] Final body used for mapping:`,
      body
    );

    // 2.1) Mapper automat pentru noile chei WP (RO) dacă lipsesc cheile noastre standard
    const hasStandardKeys =
      body &&
      typeof body === "object" &&
      ("licensePlate" in body ||
        ("startDate" in body && "endDate" in body && "startTime" in body && "endTime" in body));

    const hasRomanianWpKeys =
      body &&
      typeof body === "object" &&
      ("numar_inmatriculare" in body || "data_intrare_iesire" in body);

    // Util: parse dd.MM.yyyy -> yyyy-MM-dd
    const parseRoDate = (d?: string): string | undefined => {
      if (!d) return undefined;
      const m = d.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      if (!m) return undefined;
      const [, dd, mm, yyyy] = m;
      return `${yyyy}-${mm}-${dd}`;
    };

    // Util: split "dd.MM.yyyy - dd.MM.yyyy"
    const parseRoDateRange = (r?: string): { start?: string; end?: string } => {
      if (!r) return { start: undefined, end: undefined };
      const parts = r.split("-").map((s) => s.trim());
      if (parts.length !== 2) return { start: undefined, end: undefined };
      return {
        start: parseRoDate(parts[0]),
        end: parseRoDate(parts[1]),
      };
    };

    if (!hasStandardKeys && hasRomanianWpKeys) {
      const ro = body || {};
      const range = parseRoDateRange(ro.data_intrare_iesire);

      // Determinăm metoda de plată pe baza valorii trimise din WP
      // Conform configurării actuale a formularelor:
      //  - "1" = plata cash/card la parcare (pay_on_site)
      //  - "2" = plata online cu cardul
      const resolvedPaymentMethod =
        ro.metoda_de_plata === "1"
          ? "pay_on_site"
          : ro.metoda_de_plata === "2"
          ? "card"
          : undefined;

      // Mapăm numărul de zile și suma totală, în special pentru plata la parcare
      // Exemplu payload Jet:
      //  - numar_de_zile_sumar: "3"
      //  - plata_cash_card_la_parcare_sumar: "120.00"
      //  - pret_total_sumar: "108.00"
      // Pentru varianta pay_on_site folosim prioritar plata_cash_card_la_parcare_sumar.
      const resolvedDays =
        ro.numar_de_zile_sumar !== undefined
          ? parseInt(String(ro.numar_de_zile_sumar), 10) || undefined
          : undefined;

      let resolvedAmount: number | string | undefined;
      if (resolvedPaymentMethod === "pay_on_site") {
        resolvedAmount =
          ro.plata_cash_card_la_parcare_sumar ??
          ro.pret_total_sumar ??
          ro.plata_online_cu_cardul_sumar;
      } else if (resolvedPaymentMethod === "card") {
        resolvedAmount =
          ro.pret_total_sumar ??
          ro.plata_online_cu_cardul_sumar ??
          ro.plata_cash_card_la_parcare_sumar;
      } else {
        resolvedAmount =
          ro.pret_total_sumar ??
          ro.plata_cash_card_la_parcare_sumar ??
          ro.plata_online_cu_cardul_sumar;
      }

      const mappedFromRo = {
        // chei obligatorii mapate
        licensePlate: ro.numar_inmatriculare ? normalizeLicensePlate(String(ro.numar_inmatriculare)) : undefined,
        startDate: range.start,
        endDate: range.end,
        startTime: ro.ora_intrare || undefined,
        endTime: ro.ora_iesire || undefined,
        // plată
        paymentMethod: resolvedPaymentMethod,
        // sumar plată (zile + sumă totală)
        days: resolvedDays,
        amount: resolvedAmount,
        // date client
        firstName: ro.prenume || undefined,
        lastName: ro.nume || undefined,
        email: ro.e_mail || undefined,
        phone: ro.telefon || undefined,
        numberOfPersons: ro.numar_persoane ? parseInt(String(ro.numar_persoane), 10) || undefined : undefined,
        // adresă
        address: ro.adresa || undefined,
        city: ro.oras || undefined,
        county: ro.judet || undefined,
        country: ro.tara || undefined,
        // facturare PJ
        needInvoice: ro.doresc_factura_pentru_persoana_juridica ? true : false,
        company: ro.denumire_firma || undefined,
        companyVAT: ro.cui_cif || undefined,
        companyReg: ro.numar_registrul_comertului || undefined,
        companyAddress: ro.adresa_firma || undefined,
        // observații
        orderNotes: ro.observatii_rezervare || undefined,
      };

      console.log(`[WP-BOOKING][${reqId}] Mapped from RO keys → standard:`, mappedFromRo);

      // Doar dacă am obținut minimul obligatoriu, suprascriem body; altfel lăsăm flow-ul să dea 400 cu mesaj clar
      if (
        mappedFromRo.licensePlate &&
        mappedFromRo.startDate &&
        mappedFromRo.endDate &&
        mappedFromRo.startTime &&
        mappedFromRo.endTime
      ) {
        body = {
          ...body,
          ...mappedFromRo,
        };
      }
    }

    // 3) Extragem câmpurile esențiale
    const {
      licensePlate,
      startDate,
      startTime,
      endDate,
      endTime,
      paymentMethod,
      firstName,
      lastName,
      email,
      phone,
      numberOfPersons,
      address,
      city,
      county,
      postalCode,
      country,
      needInvoice,
      company,
      companyVAT,
      companyReg,
      companyAddress,
      acceptTerms,
      // optional for card
      amount,
      days,
      paymentIntentId,
      orderNotes,
    } = body || {};

    console.log(
      `[WP-BOOKING][${reqId}] Required fields extracted:`,
      {
        licensePlate,
        startDate,
        startTime,
        endDate,
        endTime,
      }
    );

    if (!licensePlate || !startDate || !startTime || !endDate || !endTime) {
      console.error(
        `[WP-BOOKING][${reqId}] Missing required fields: licensePlate=${licensePlate}, startDate=${startDate}, startTime=${startTime}, endDate=${endDate}, endTime=${endTime}`
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

    // 4) Pregătim FormData pentru fluxul existent
    const fd = new FormData();
    fd.append("licensePlate", normalizeLicensePlate(String(licensePlate)));
    fd.append("startDate", String(startDate));
    fd.append("startTime", String(startTime));
    fd.append("endDate", String(endDate));
    fd.append("endTime", String(endTime));

    const clientName =
      `${firstName || ""} ${lastName || ""}`.trim() || undefined;

    if (clientName) {
      fd.append("clientName", clientName);
    }
    if (firstName) {
      fd.append("clientTitle", String(firstName));
    }

    const method = String(paymentMethod || "").toLowerCase();
    const isPayOnSite = method === "pay_on_site";

    const resolvedSource: "webhook" | "pay_on_site" = isPayOnSite
      ? "pay_on_site"
      : "webhook";

    const resolvedPaymentStatus: PaymentStatus = isPayOnSite
      ? "pending"
      : "paid";

    console.log(`[WP-BOOKING][${reqId}] Mapped booking core data:`, {
      licensePlate: normalizeLicensePlate(String(licensePlate)),
      startDate,
      startTime,
      endDate,
      endTime,
      clientName,
      email,
      phone,
      numberOfPersons,
      paymentMethod,
      resolvedSource,
      resolvedPaymentStatus,
      amount,
      days,
      paymentIntentId,
    });

    // 5) Apelăm fluxul standard de creare rezervare
    const result = await createBookingWithFirestore(fd, {
      clientEmail: email,
      clientPhone: phone,
      numberOfPersons: parseInt(String(numberOfPersons || "1")) || 1,
      paymentStatus: resolvedPaymentStatus,
      source: resolvedSource,
      // adresă & facturare
      address,
      city,
      county,
      postalCode,
      country,
      needInvoice: !!needInvoice,
      company: needInvoice ? company : undefined,
      companyVAT: needInvoice ? companyVAT : undefined,
      companyReg: needInvoice ? companyReg : undefined,
      companyAddress: needInvoice ? companyAddress : undefined,
      // termeni
      termsAccepted: !!acceptTerms,
      // card extras
      amount:
        typeof amount === "number"
          ? amount
          : amount !== undefined
          ? parseFloat(String(amount)) || undefined
          : undefined,
      days:
        typeof days === "number"
          ? days
          : days !== undefined
          ? parseInt(String(days), 10) || undefined
          : undefined,
      paymentIntentId:
        typeof paymentIntentId === "string" && paymentIntentId.trim()
          ? paymentIntentId
          : undefined,
      orderNotes,
    });

    console.log(
      `[WP-BOOKING][${reqId}] Firestore booking result:`,
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
      `[WP-BOOKING][${reqId}] ERROR while handling booking:`,
      error
    );

    return NextResponse.json(
      { success: false, error: message },
      { status: 500, headers: corsHeaders }
    );
  }
}
