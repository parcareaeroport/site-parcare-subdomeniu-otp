import { withLprRequest, lprLog, lprFields } from "@/lib/lpr-log.server"
// -----------------------------------------------------------------------------
//  Metrici LPR integration – dynamic route "app/api/metrici-lpr/[type]/route.ts"
// -----------------------------------------------------------------------------
//  Two URLs you will configure in Metrici UI:
//    • Check‑action URL:   https://<host>/api/metrici-lpr/check
//    • Reporting URL:     https://<host>/api/metrici-lpr/report
//
//  ENVIRONMENT VARIABLES:
//    • LPR_API_ACTIVE="false"     ➜ KILL SWITCH - oprește complet API-ul (503 error)
//    • LPR_ENABLED="false"        ➜ Returnează token corect dar nu procesează (200 OK)
//    • LPR_DEBUG_MODE="true"      ➜ Log-uri detaliate pentru debugging
//
//  IMPORTANT ➜  This file *must* live at `app/api/metrici-lpr/[type]/route.ts`.
//  If you still have `app/api/metrici-lpr/route.ts`, delete or rename it –
//  otherwise Next.js thinks the route is *static* and your second argument
//  (`params`) becomes invalid, exactly the error you just saw during build.
// -----------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";      // avoid 4 MB body limit of Edge
export const maxDuration = 60;        // seconds – tweak as needed

// Tokens defined by Metrici spec (July 2024)
const TOKEN_CHECK_OK = "fbd782b5b1f90875a9773ef20bcc16aa";
const TOKEN_REPORT_OK = "bb1e8f805814a0b8e465601346872377"; // <- trailing 7!



async function POSTHandler(
  request: NextRequest,
  { params }: { params: Promise<{ type: string }> }   // <-- Next.js 15 async params
) {
  // ---------------------------------------------------------------------------
  // 0. KILL SWITCH - păstrează răspunsul existent; loggerul explică refuzul
  // ---------------------------------------------------------------------------
  if (process.env.LPR_API_ACTIVE === "false") {
    lprFields({reason:"disabled",outcome:"disabled"})
    // Nu procesăm mesajul când endpointul este dezactivat.
    return new Response("", { status: 204 }); // No Content
  }

  // ---------------------------------------------------------------------------
  // 1. Runtime flags & early exit if feature disabled
  // ---------------------------------------------------------------------------
  const resolvedParams = await params;
  const type = resolvedParams.type.toLowerCase();           // "check" | "report"
  const enabled         = process.env.LPR_ENABLED !== "false";
  const debug           = process.env.LPR_DEBUG_MODE === "true";
  const autoOpenBarrier = process.env.LPR_AUTO_OPEN_BARRIER !== "false";
  const defaultAction   = process.env.LPR_DEFAULT_ACTION ?? "allow"; // allow | deny

  if (!enabled) {
    lprFields({reason:"disabled",outcome:"disabled"})
    return new Response(type === "check" ? TOKEN_CHECK_OK : TOKEN_REPORT_OK, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Request metadata & auth
  // ---------------------------------------------------------------------------
  const start = Date.now();
  const reqId = `LPR_${start}_${Math.random().toString(36).slice(2, 11)}`;

  if (process.env.LPR_AUTH_SECRET) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.LPR_AUTH_SECRET}`) {
      lprFields({reason:"unauthorized",outcome:"skipped"}); lprLog("auth_rejected",{reason:"unauthorized"},"warn")

      return new Response(type === "check" ? TOKEN_CHECK_OK : TOKEN_REPORT_OK, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

  }

  // ---------------------------------------------------------------------------
  // 3. Parse multipart/form-data
  // ---------------------------------------------------------------------------
  const formData = await request.formData();
  const lpr: Record<string, string> = {};
  let imageCount = 0;

  for (const [key, value] of formData.entries()) {
    if (value instanceof File) {
      imageCount++;

    } else {
      lpr[key] = value.toString();

    }
  }

  lprFields({plate:lpr.number?.replace(/[^a-zA-Z0-9]/g, "").toUpperCase(),receivedDirection:lpr.direction,deviceId:lpr.id,outcome:"receipt_only"})
  const hasPlate   = Boolean(lpr.number);
  const direction  = lpr.direction ?? "";             // "1" in, "2" out, "3" unknown
  const isEntering = direction === "1";

  // ---------------------------------------------------------------------------
  // 4. Decide response token
  // ---------------------------------------------------------------------------
  let responseStr = type === "check" ? TOKEN_CHECK_OK : TOKEN_REPORT_OK;

  if (
    type === "check" &&
    hasPlate &&
    isEntering &&
    defaultAction === "allow" &&
    autoOpenBarrier
  ) {
    responseStr += " open_barrier";
  }

  // ---------------------------------------------------------------------------
  // 5. Return 200 + raw token (no newline)
  // ---------------------------------------------------------------------------
  lprLog("metrici_response",{outcome:"receipt_only",imageCount,textFieldCount:Object.keys(lpr).length,barrierCommand:responseStr.endsWith(" open_barrier"),responseRequestId:reqId})
  const ms = Date.now() - start;

  return new Response(responseStr, {
    status: 200,
    headers: {
      "Content-Type": "text/plain",
      "X-Request-ID": reqId,
      "X-Processing-Time": ms.toString(),
      "X-LPR-Mode": debug ? "debug" : "production",
      "X-Images-Count": imageCount.toString(),
    },
  });
}

// 6. Any other HTTP verb → 405
function GETHandler() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}


export const POST = withLprRequest(POSTHandler)
export const GET = withLprRequest(GETHandler)

export const PUT = GET;
export const DELETE = GET;
