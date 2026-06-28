import nodemailer from "nodemailer"

export type ModificationCurrent = {
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  licensePlate: string
  numberOfPersons: number | string
}

export type ModificationRequested = {
  newStartDate?: string
  newStartTime?: string
  newEndDate?: string
  newEndTime?: string
  newLicensePlate?: string
  note?: string
}

/** Firestore rejects undefined field values — keep only defined modification fields. */
export function compactModificationRequested(
  requested: ModificationRequested
): ModificationRequested {
  return Object.fromEntries(
    Object.entries(requested).filter(([, value]) => value !== undefined)
  ) as ModificationRequested
}

export function parseModificationRequested(
  body: Record<string, unknown>
): ModificationRequested {
  const requested: ModificationRequested = {}

  const newStartDate = asModificationField(body.newStartDate)
  if (newStartDate) requested.newStartDate = newStartDate

  const newStartTime = asModificationField(body.newStartTime)
  if (newStartTime) requested.newStartTime = newStartTime

  const newEndDate = asModificationField(body.newEndDate)
  if (newEndDate) requested.newEndDate = newEndDate

  const newEndTime = asModificationField(body.newEndTime)
  if (newEndTime) requested.newEndTime = newEndTime

  const newLicensePlate = asModificationField(body.newLicensePlate)?.toUpperCase()
  if (newLicensePlate) requested.newLicensePlate = newLicensePlate

  const note = asModificationField(body.note)
  if (note) requested.note = note

  return requested
}

function asModificationField(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const trimmed = String(value).trim()
  return trimmed ? trimmed : undefined
}

export type ModificationEmailData = {
  firstName: string
  lastName: string
  phone: string
  email: string
  bookingNumber: string
  current: ModificationCurrent
  requested: ModificationRequested
  priceImpact?: {
    currentAmount: number
    newAmount: number
    difference: number
    billableDays: number
  }
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

function diffRow(label: string, oldValue: string, newValue: string | undefined): string {
  const trimmedNew = (newValue ?? "").toString().trim()
  if (!trimmedNew) return ""
  const changed = trimmedNew !== oldValue
  const newCell = changed
    ? `<strong style="color:#15803D">${trimmedNew}</strong>`
    : `<span style="color:#6B7280">${trimmedNew} (neschimbat)</span>`
  return `
    <tr>
      <th>${label}</th>
      <td>${oldValue || "—"}</td>
      <td>${newCell}</td>
    </tr>
  `
}

function generateModificationEmailHTML(data: ModificationEmailData): string {
  const { current, requested } = data
  const note = (requested.note || "").trim()

  const rows = [
    diffRow("Data intrare", current.startDate, requested.newStartDate),
    diffRow("Ora intrare", current.startTime, requested.newStartTime),
    diffRow("Data ieșire", current.endDate, requested.newEndDate),
    diffRow("Ora ieșire", current.endTime, requested.newEndTime),
    diffRow("Nr. înmatriculare", current.licensePlate, requested.newLicensePlate),
  ]
    .filter(Boolean)
    .join("\n")
  const priceImpact = data.priceImpact
  const pricePolicy = priceImpact
    ? priceImpact.difference > 0
      ? `Clientul trebuie să achite diferența de ${priceImpact.difference.toFixed(2)} lei înainte de confirmarea modificării.`
      : priceImpact.difference < 0
        ? `Valoarea scade cu ${Math.abs(priceImpact.difference).toFixed(2)} lei; diferența rămâne avans pentru o rezervare viitoare.`
        : "Nu există diferență de preț."
    : ""

  return `
    <!DOCTYPE html>
    <html lang="ro">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Cerere Modificare Rezervare</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px; background-color: #f5f5f5; }
        .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        .header { background: linear-gradient(135deg, #ee7f1a, #d67016); color: white; padding: 20px; text-align: center; }
        .header h1 { color: #ffffff; margin: 0; font-size: 22px; }
        .content { padding: 30px; }
        .details-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        .details-table th, .details-table td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; vertical-align: top; }
        .details-table th { background-color: #f8f9fa; font-weight: 600; color: #495057; width: 32%; }
        .highlight { background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 5px; padding: 15px; margin: 20px 0; }
        .note-box { background-color: #eef2ff; border-left: 4px solid #6366f1; padding: 12px 16px; border-radius: 4px; margin: 16px 0; white-space: pre-wrap; }
        .footer { background-color: #f8f9fa; padding: 20px; text-align: center; color: #666; font-size: 14px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Cerere Modificare Rezervare</h1>
          <p>Un client a solicitat modificarea unei rezervări existente</p>
        </div>

        <div class="content">
          <div class="highlight">
            <strong>CERERE DE MODIFICARE REZERVARE</strong><br>
            Verificați diferențele de mai jos și contactați clientul pentru confirmare.
          </div>

          <h2>Detalii Client</h2>
          <table class="details-table">
            <tr>
              <th>Nume complet</th>
              <td colspan="2">${data.firstName} ${data.lastName}</td>
            </tr>
            <tr>
              <th>Telefon</th>
              <td colspan="2">${data.phone}</td>
            </tr>
            <tr>
              <th>Email</th>
              <td colspan="2">${data.email}</td>
            </tr>
            <tr>
              <th>Număr rezervare</th>
              <td colspan="2"><strong>${data.bookingNumber}</strong></td>
            </tr>
          </table>

          <h2>Modificări solicitate</h2>
          <table class="details-table">
            <tr>
              <th>Câmp</th>
              <th>Valoare actuală</th>
              <th>Valoare cerută</th>
            </tr>
            ${rows || `<tr><td colspan="3" style="text-align:center;color:#9CA3AF">Niciun câmp specificat (vezi nota clientului)</td></tr>`}
          </table>

          ${note
            ? `<h2>Notă client</h2><div class="note-box">${note.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>`
            : ""}

          ${priceImpact
            ? `<h2>Impact preț</h2>
              <table class="details-table">
                <tr><th>Valoare actuală</th><td colspan="2">${priceImpact.currentAmount.toFixed(2)} lei</td></tr>
                <tr><th>Valoare estimată nouă</th><td colspan="2">${priceImpact.newAmount.toFixed(2)} lei</td></tr>
                <tr><th>Diferență</th><td colspan="2"><strong>${priceImpact.difference.toFixed(2)} lei</strong></td></tr>
                <tr><th>Zile taxabile nou</th><td colspan="2">${priceImpact.billableDays}</td></tr>
                <tr><th>Regulă</th><td colspan="2">${pricePolicy}</td></tr>
              </table>`
            : ""}

          <div class="highlight">
            <strong>Acțiuni recomandate:</strong><br>
            • Verificați disponibilitatea pentru noile date<br>
            • Aplicați regula de preț: diferență de încasat sau avans pentru rezervare viitoare<br>
            • Contactați clientul pentru confirmare<br>
            • Clarificați cu Alin dacă modificarea se face direct în Multipark sau prin anulare + rezervare nouă
          </div>
        </div>

        <div class="footer">
          <p>Cerere trimisă din aplicația mobilă OTP Parking.</p>
          <p>Data și ora: ${new Date().toLocaleString("ro-RO")}</p>
        </div>
      </div>
    </body>
    </html>
  `
}

export function validateModificationEmailData(
  data: Partial<ModificationEmailData>
): string | null {
  const { firstName, lastName, phone, email, bookingNumber, current, requested } = data
  if (!firstName || !lastName || !phone || !email || !bookingNumber || !current) {
    return "Toate câmpurile sunt obligatorii"
  }
  if (!requested) {
    return "Niciun câmp modificat"
  }
  const hasAnyChange =
    !!requested.newStartDate ||
    !!requested.newStartTime ||
    !!requested.newEndDate ||
    !!requested.newEndTime ||
    !!requested.newLicensePlate ||
    !!(requested.note && requested.note.trim())
  if (!hasAnyChange) {
    return "Niciun câmp modificat"
  }
  return null
}

export async function sendModificationRequestEmail(data: ModificationEmailData) {
  const validationError = validateModificationEmailData(data)
  if (validationError) {
    throw new Error(validationError)
  }

  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    throw new Error("Configurație email lipsă")
  }

  const transporter = createEmailTransporter()
  const { firstName, lastName, email, bookingNumber, current } = data

  const mailOptions = {
    from: {
      name: "OTP Parking - Modificări",
      address: process.env.GMAIL_USER as string,
    },
    to: process.env.GMAIL_USER as string,
    subject: `Cerere modificare rezervare #${bookingNumber} - ${current.licensePlate || "—"}`,
    html: generateModificationEmailHTML(data),
    replyTo: email,
  }

  console.log(`📧 Sending modification request for booking ${bookingNumber}`)
  console.log(`   📧 Client: ${firstName} ${lastName} (${email})`)

  const emailResult = await transporter.sendMail(mailOptions)
  console.log(`✅ MODIFICATION REQUEST EMAIL SENT (id=${emailResult.messageId})`)

  return {
    message: "Cererea de modificare a fost trimisă cu succes",
    messageId: emailResult.messageId,
    timestamp: new Date().toISOString(),
  }
}
