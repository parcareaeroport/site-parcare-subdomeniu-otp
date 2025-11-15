import { NextRequest, NextResponse } from "next/server";
import { createBookingWithFirestore } from "@/app/actions/booking-actions";
import { normalizeLicensePlate } from "@/lib/utils";

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
