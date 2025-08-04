// -----------------------------------------------------------------------------
//  Metrici LPR integration – dynamic route "app/api/metrici-lpr/[type]/route.ts"
// -----------------------------------------------------------------------------
//  Two URLs you will configure in Metrici UI:
//    • Check‑action URL:   https://<host>/api/metrici-lpr/check
//    • Reporting URL:     https://<host>/api/metrici-lpr/report
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

// Helper – log only when DEBUG enabled
function dbg(debug: boolean, ...args: unknown[]) {
  if (debug) console.log(...args);
}

export async function POST(
  request: NextRequest,
  { params }: { params: { type: string } }   // <-- works only in a *dynamic* route
) {
  // ---------------------------------------------------------------------------
  // 0. Runtime flags & early exit if feature disabled
  // ---------------------------------------------------------------------------
  const type = params.type.toLowerCase();           // "check" | "report"
  const enabled         = process.env.LPR_ENABLED !== "false";
  const debug           = process.env.LPR_DEBUG_MODE === "true";
  const autoOpenBarrier = process.env.LPR_AUTO_OPEN_BARRIER !== "false";
  const defaultAction   = process.env.LPR_DEFAULT_ACTION ?? "allow"; // allow | deny

  if (!enabled) {
    return new Response(type === "check" ? TOKEN_CHECK_OK : TOKEN_REPORT_OK, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  // ---------------------------------------------------------------------------
  // 1. Request metadata & auth
  // ---------------------------------------------------------------------------
  const start = Date.now();
  const reqId = `LPR_${start}_${Math.random().toString(36).slice(2, 11)}`;

  console.log(`🚗 [${reqId}] === ${type.toUpperCase()} LPR EVENT ===`);
  dbg(debug, `🐛 [${reqId}] Headers:`, Object.fromEntries(request.headers.entries()));

  if (process.env.LPR_AUTH_SECRET) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.LPR_AUTH_SECRET}`) {
      console.warn(`🔒 [${reqId}] Invalid Bearer token – acknowledging but skipping.`);
      return new Response(type === "check" ? TOKEN_CHECK_OK : TOKEN_REPORT_OK, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }
    dbg(debug, `🔐 [${reqId}] Auth OK`);
  }

  // ---------------------------------------------------------------------------
  // 2. Parse multipart/form-data
  // ---------------------------------------------------------------------------
  const formData = await request.formData();
  const lpr: Record<string, string> = {};
  let imageCount = 0;

  for (const [key, value] of formData.entries()) {
    if (value instanceof File) {
      imageCount++;
      dbg(debug, `🖼️ [${reqId}] ${key}: ${value.name} (${value.size} B)`);
    } else {
      lpr[key] = value.toString();
      dbg(debug, `📝 [${reqId}] ${key}: ${lpr[key]}`);
    }
  }

  const hasPlate   = Boolean(lpr.number);
  const direction  = lpr.direction ?? "";             // "1" in, "2" out, "3" unknown
  const isEntering = direction === "1" || direction === 1;

  // ---------------------------------------------------------------------------
  // 3. Decide response token
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
  // 4. Return 200 + raw token (no newline)
  // ---------------------------------------------------------------------------
  const ms = Date.now() - start;
  console.log(`✅ [${reqId}] ${ms} ms → \`${responseStr}\``);

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

// 5. Any other HTTP verb → 405
export function GET() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
export const PUT = GET;
export const DELETE = GET;
