// app/api/metrici-lpr/[type]/route.ts
// ------------------------------------------------------------
// Metrici LPR integration – unified handler for both "check-action"
// and "reporting" events, using a dynamic route segment (`check` | `report`).
// Add the following URLs in the Metrici UI:
//   • Check‑action URL:   https://<host>/api/metrici-lpr/check
//   • Reporting URL:     https://<host>/api/metrici-lpr/report
// ------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";

// Run on Node.js to avoid edge body‑size limits and allow larger JPEG payloads
export const runtime = "nodejs";
// Allow up to 60 s for very large uploads (optional; tweak as needed)
export const maxDuration = 60;

// Spec‑defined reply constants
const CHECK_OK = "fbd782b5b1f90875a9773ef20bcc16aa";
const REPORTING_OK = "bb1e8f805814a0b8e465601346872377"; // NOTE the trailing 7!

// Helper: log nicely only when DEBUG enabled
function dbg(enabled: boolean, ...args: unknown[]) {
  if (enabled) console.log(...args);
}

export async function POST(
  request: NextRequest,
  { params }: { params: { type?: string } }
) {
  // -----------------------------------------------------------------------
  // 0. Early exits / runtime flags
  // -----------------------------------------------------------------------
  const type = (params.type ?? "report").toLowerCase(); // default to reporting
  const enabled = process.env.LPR_ENABLED !== "false"; // default TRUE
  const debug = process.env.LPR_DEBUG_MODE === "true";
  const autoOpenBarrier = process.env.LPR_AUTO_OPEN_BARRIER !== "false";
  const defaultAction = process.env.LPR_DEFAULT_ACTION ?? "allow"; // allow | deny | log

  // If feature toggled off, still answer with correct token so Metrici stops retrying
  if (!enabled) {
    return new Response(type === "check" ? CHECK_OK : REPORTING_OK, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  // -----------------------------------------------------------------------
  // 1. House‑keeping – request metadata & logging scaffold
  // -----------------------------------------------------------------------
  const start = Date.now();
  const id = `LPR_${start}_${Math.random().toString(36).slice(2, 11)}`;

  console.log(`🚗  [${id}] === ${type.toUpperCase()} LPR EVENT RECEIVED ===`);
  dbg(debug, `🐛  [${id}] Headers:`, Object.fromEntries(request.headers.entries()));

  // -----------------------------------------------------------------------
  // 2. Basic auth header (optional)
  // -----------------------------------------------------------------------
  if (process.env.LPR_AUTH_SECRET) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.LPR_AUTH_SECRET}`) {
      console.warn(`🔒  [${id}] Invalid auth token – ignoring but acknowledging.`);
      // Respond with OK token anyway → Metrici won’t retry forever
      return new Response(type === "check" ? CHECK_OK : REPORTING_OK, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }
    dbg(debug, `🔐  [${id}] Authentication successful`);
  }

  // -----------------------------------------------------------------------
  // 3. Parse multipart/form‑data (text fields + images)
  // -----------------------------------------------------------------------
  const formData = await request.formData();
  const lprData: Record<string, string> = {};
  let imageCount = 0;

  for (const [key, value] of formData.entries()) {
    if (value instanceof File) {
      imageCount++;
      dbg(debug, `🖼️  [${id}] Image → ${key}: ${value.name} (${value.size} B)`);
    } else {
      lprData[key] = value.toString();
      dbg(debug, `📝  [${id}] ${key}: ${lprData[key]}`);
    }
  }

  const hasPlate = Boolean(lprData.number);
  const dir = lprData.direction ?? ""; // "1"‑in, "2"‑out, "3"‑unknown
  const isEntering = dir === "1" || dir === 1;

  // -----------------------------------------------------------------------
  // 4. Decide response token & optional open_barrier flag (SPEC‑driven)
  // -----------------------------------------------------------------------
  let responseText = REPORTING_OK; // default for "report"

  if (type === "check") {
    responseText = CHECK_OK;
    if (
      hasPlate &&
      isEntering &&
      defaultAction === "allow" &&
      autoOpenBarrier
    ) {
      responseText += " open_barrier";
    }
  }

  // -----------------------------------------------------------------------
  // 5. Return – always 200 + raw token string (no CRLF)
  // -----------------------------------------------------------------------
  const ms = Date.now() - start;
  console.log(`✅  [${id}] Done in ${ms} ms – reply: \`${responseText}\``);

  return new Response(responseText, {
    status: 200,
    headers: {
      "Content-Type": "text/plain",
      "X-LPR-Mode": debug ? "debug" : "production",
      "X-Request-ID": id,
      "X-Processing-Time": ms.toString(),
      "X-Images-Count": imageCount.toString(),
    },
  });
}

// ---------------------------------------------------------------------------
// 6. Non‑POST methods → 405 Method Not Allowed (Metrici never uses these)
// ---------------------------------------------------------------------------
export function GET() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
export const PUT = GET;
export const DELETE = GET;
