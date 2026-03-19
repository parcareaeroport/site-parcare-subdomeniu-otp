import { NextRequest, NextResponse } from "next/server"
import nodemailer from "nodemailer"
import { db } from "@/lib/firebase"
import { doc, getDoc } from "firebase/firestore"
import { authorizeAdminRequest } from "@/lib/admin-api-auth"

type Body = {
  bookingId?: string
  reason?: string
}

function createEmailTransporter() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  })
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

function generateCancelConfirmationHtml(input: {
  clientName: string
  licensePlate: string
  bookingNumber: string
  startLabel: string
  endLabel: string
  reason?: string
}) {
  const reasonHtml = input.reason ? `<p><strong>Motiv:</strong> ${escapeHtml(input.reason)}</p>` : ""
  return `
<!doctype html>
<html lang="ro">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Confirmare anulare rezervare</title>
    <style>
      body { font-family: Arial, sans-serif; background:#f5f5f5; padding: 20px; }
      .card { max-width: 640px; margin: 0 auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.08); }
      .header { background: #dc3545; color: white; padding: 18px 22px; }
      .content { padding: 22px; color: #111827; }
      .muted { color: #6b7280; }
      .row { padding: 10px 0; border-bottom: 1px solid #eee; }
      .row:last-child { border-bottom: 0; }
      .label { font-weight: 700; color: #374151; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="header">
        <h2 style="margin:0;">🚫 Rezervare anulată</h2>
        <p style="margin:6px 0 0 0;">Confirmare anulare rezervare OTP Parking</p>
      </div>
      <div class="content">
        <p>Bună, <strong>${escapeHtml(input.clientName || "client")}</strong>,</p>
        <p>Rezervarea ta a fost <strong>ANULATĂ</strong>.</p>
        ${reasonHtml}
        <div style="margin-top: 14px;">
          <div class="row"><span class="label">Număr rezervare:</span> ${escapeHtml(input.bookingNumber)}</div>
          <div class="row"><span class="label">Număr înmatriculare:</span> ${escapeHtml(input.licensePlate)}</div>
          <div class="row"><span class="label">Intrare:</span> ${escapeHtml(input.startLabel)}</div>
          <div class="row"><span class="label">Ieșire:</span> ${escapeHtml(input.endLabel)}</div>
        </div>
        <p class="muted" style="margin-top: 18px;">
          Dacă ai întrebări, răspunde la acest email sau contactează-ne la ${escapeHtml(process.env.GMAIL_USER || "contact.parcareaeroport@gmail.com")}.
        </p>
      </div>
    </div>
  </body>
</html>
`
}

export async function POST(req: NextRequest) {
  const authResult = await authorizeAdminRequest(req, ["admin"])
  if (!authResult.ok) {
    return authResult.response
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Body
    const bookingId = String(body.bookingId || "").trim()
    const reason = body.reason ? String(body.reason).trim() : undefined

    if (!bookingId) {
      return NextResponse.json({ error: "Missing bookingId" }, { status: 400 })
    }
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
      return NextResponse.json({ error: "Missing email config" }, { status: 500 })
    }

    const snap = await getDoc(doc(db, "bookings", bookingId))
    if (!snap.exists()) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 })
    }
    const b: any = snap.data()
    const clientEmail = String(b?.clientEmail || "").trim()
    if (!clientEmail) {
      return NextResponse.json({ error: "Booking has no clientEmail" }, { status: 400 })
    }

    const bookingNumber = b?.apiBookingNumber ? String(b.apiBookingNumber) : bookingId
    const startLabel = `${b?.startDate || "-"}${b?.startTime ? ` ${b.startTime}` : ""}`
    const endLabel = `${b?.endDate || "-"}${b?.endTime ? ` ${b.endTime}` : ""}`
    const licensePlate = String(b?.licensePlate || "N/A")
    const clientName = String(b?.clientName || "")

    const transporter = createEmailTransporter()
    const html = generateCancelConfirmationHtml({
      clientName,
      licensePlate,
      bookingNumber,
      startLabel,
      endLabel,
      reason,
    })

    const subject = `🚫 Rezervare anulată - ${licensePlate}`
    const info = await transporter.sendMail({
      from: { name: "OTP Parking - Anulări", address: process.env.GMAIL_USER },
      to: clientEmail,
      subject,
      html,
    })

    return NextResponse.json({ ok: true, messageId: info.messageId })
  } catch (e) {
    console.error("send-cancel-confirmation failed", e)
    return NextResponse.json({ error: "Failed to send cancel confirmation" }, { status: 500 })
  }
}


