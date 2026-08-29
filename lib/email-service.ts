// Notă: Trebuie instalat pachetul: npm install nodemailer @types/nodemailer

import nodemailer from 'nodemailer'
import fs from 'fs'
import path from 'path'
import { buildSignedQrUrl, getSiteBaseUrl } from './qr-link'

// Interfață pentru datele de rezervare pentru email
interface BookingEmailData {
  // Date client
  clientName: string
  clientEmail: string
  clientPhone?: string
  
  // Date rezervare
  licensePlate: string
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  days: number
  amount: number
  
  // Date sistem
  bookingNumber?: string // Opțional pentru pay-on-site (nu au booking number)
  status: string
  source: "webhook" | "test_mode" | "manual" | "pay_on_site"
  createdAt: Date
  // Rendering helpers (optional; computed in sendBookingConfirmationEmail)
  qrLinkUrl?: string
}

export interface BookingModificationConfirmationEmailData {
  clientName: string
  clientEmail: string
  licensePlate: string
  oldLicensePlate: string
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  oldStartDate: string
  oldStartTime: string
  oldEndDate: string
  oldEndTime: string
  days: number
  oldAmount: number
  newAmount: number
  difference: number
  amountToPay: number
  creditAmount: number
  bookingNumber?: string
  oldBookingNumber?: string
  source: "online" | "pay_on_site"
  modifiedAt: Date
  qrLinkUrl?: string
}

/**
 * Configurează transporterul Nodemailer pentru Gmail cu setări robuste
 */
function createEmailTransporter() {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // true pentru 465, false pentru alte porturi
    auth: {
      user: process.env.GMAIL_USER!, // Adaugă în .env.local
      pass: process.env.GMAIL_APP_PASSWORD!, // App Password generat în Gmail
    },
    connectionTimeout: 30000, // 30 secunde connection timeout
    greetingTimeout: 30000,   // 30 secunde greeting timeout  
    socketTimeout: 30000,     // 30 secunde socket timeout
    debug: false,             // activează doar pentru debugging SMTP
    logger: false,            // elimină log-urile SMTP verbose
  } as any) // bypass TypeScript pentru setări avansate
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

export function generateBookingModificationConfirmationEmailHTML(data: BookingModificationConfirmationEmailData): string {
  const isPayOnSite = data.source === "pay_on_site"
  const formattedBookingNumber = data.bookingNumber ? data.bookingNumber.padStart(6, "0") : ""
  const formattedOldBookingNumber = data.oldBookingNumber ? data.oldBookingNumber.padStart(6, "0") : ""
  const differenceText =
    data.difference > 0
      ? `Diferență ${isPayOnSite ? "actualizată la parcare" : "achitată"}: ${data.difference.toFixed(2)} RON`
      : data.difference < 0
        ? `${Math.abs(data.difference).toFixed(2)} RON ${isPayOnSite ? "scădere din suma datorată la parcare" : "rămân avans pentru o rezervare viitoare"}`
        : "Nu există diferență de plată."

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Rezervare modificată OTP Parking</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #ee7f1a, #d67016); color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
        .header h1 { color: #ffffff; margin: 8px 0; font-size: 22px; line-height: 1.25; }
        .header p { color: #fff7ed; margin: 5px 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .box { background: white; padding: 20px; border-radius: 8px; margin: 18px 0; }
        .detail-row { display: flex; justify-content: space-between; gap: 16px; padding: 8px 0; border-bottom: 1px solid #eee; }
        .detail-label { font-weight: bold; color: #666; }
        .detail-value { color: #333; text-align: right; }
        .notice { background: #fff3cd; border: 1px solid #ffeaa7; color: #856404; padding: 15px; border-radius: 8px; margin: 20px 0; }
        .success { background: #ecfdf5; border: 1px solid #bbf7d0; color: #166534; padding: 15px; border-radius: 8px; margin: 20px 0; }
        .qr-section { text-align: center; background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .qr-button { display: inline-block; background: #ee7f1a; color: white !important; padding: 12px 16px; border-radius: 8px; text-decoration: none; font-weight: bold; }
        .footer { text-align: center; color: #666; font-size: 12px; margin-top: 30px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Rezervarea a fost modificată</h1>
          <p>OTP Parking a actualizat detaliile rezervării dumneavoastră.</p>
        </div>
        <div class="content">
          <div class="success">
            <strong>Modificare confirmată</strong><br>
            ${isPayOnSite
              ? "Suma de plată la parcare a fost actualizată local. Plata se face la sosire."
              : "Rezervarea a fost recreată în sistemul de parcare. Folosiți noul cod QR de mai jos."}
          </div>

          <h2>Detalii noi</h2>
          <div class="box">
            ${!isPayOnSite ? `
            <div class="detail-row">
              <span class="detail-label">Număr rezervare nou:</span>
              <span class="detail-value"><strong>${escapeHtml(formattedBookingNumber)}</strong></span>
            </div>
            ${formattedOldBookingNumber ? `
            <div class="detail-row">
              <span class="detail-label">Număr rezervare vechi:</span>
              <span class="detail-value">${escapeHtml(formattedOldBookingNumber)}</span>
            </div>
            ` : ""}
            ` : ""}
            <div class="detail-row">
              <span class="detail-label">Număr înmatriculare:</span>
              <span class="detail-value">${escapeHtml(data.licensePlate)}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Intrare:</span>
              <span class="detail-value">${escapeHtml(data.startDate)} ${escapeHtml(data.startTime)}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Ieșire:</span>
              <span class="detail-value">${escapeHtml(data.endDate)} ${escapeHtml(data.endTime)}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Valoare nouă:</span>
              <span class="detail-value"><strong>${data.newAmount.toFixed(2)} RON</strong></span>
            </div>
          </div>

          <h2>Ce s-a schimbat</h2>
          <div class="box">
            <div class="detail-row">
              <span class="detail-label">Perioadă veche:</span>
              <span class="detail-value">${escapeHtml(data.oldStartDate)} ${escapeHtml(data.oldStartTime)} → ${escapeHtml(data.oldEndDate)} ${escapeHtml(data.oldEndTime)}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Perioadă nouă:</span>
              <span class="detail-value">${escapeHtml(data.startDate)} ${escapeHtml(data.startTime)} → ${escapeHtml(data.endDate)} ${escapeHtml(data.endTime)}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Mașină veche:</span>
              <span class="detail-value">${escapeHtml(data.oldLicensePlate)}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Mașină nouă:</span>
              <span class="detail-value">${escapeHtml(data.licensePlate)}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Valoare inițială:</span>
              <span class="detail-value">${data.oldAmount.toFixed(2)} RON</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Diferență:</span>
              <span class="detail-value"><strong>${differenceText}</strong></span>
            </div>
          </div>

          ${isPayOnSite ? `
          <div class="notice">
            <strong>Plată la parcare</strong><br>
            Prezentați-vă la sosire și plătiți ${data.newAmount.toFixed(2)} RON la recepția parcării.
          </div>
          ` : `
          <div class="qr-section">
            <h3>Cod QR nou pentru acces</h3>
            <p>Codul vechi nu mai trebuie folosit pentru această rezervare modificată.</p>
            ${data.qrLinkUrl ? `
              <p style="margin: 14px 0;">
                <a class="qr-button" href="${data.qrLinkUrl}">Deschide noul cod QR</a>
              </p>
              <p><small>Cod QR: MPK_RES=${escapeHtml(formattedBookingNumber)}</small></p>
            ` : `
              <p style="color:#b91c1c;"><strong>Link QR indisponibil momentan.</strong></p>
              <p><small>Cod rezervare: ${escapeHtml(formattedBookingNumber)}</small></p>
            `}
          </div>
          `}

          <div class="notice">
            <strong>Important:</strong><br>
            • Păstrați acest email pentru acces și verificări.<br>
            • Anularea rezervării se poate solicita cu minimum 24 de ore înainte de sosire.<br>
            • Pentru suport: contact.parcareaeroport@gmail.com sau 0742.039.955.
          </div>
        </div>
        <div class="footer">
          <p>Acest email a fost trimis automat de sistemul OTP Parking.</p>
          <p>Modificare aplicată la: ${data.modifiedAt.toLocaleString("ro-RO")}</p>
        </div>
      </div>
    </body>
    </html>
  `
}

export async function sendBookingModificationConfirmationEmail(
  data: BookingModificationConfirmationEmailData
): Promise<{
  success: boolean
  error?: string
  messageId?: string
  response?: string
  qrIncluded?: boolean
}> {
  const bookingRef = data.bookingNumber || `pay_on_site_${data.licensePlate}`
  const emailProcessId = `MODIFICATION_${bookingRef}_${Date.now()}`

  try {
    console.log(`📧 [EMAIL-${emailProcessId}] ===== STARTING MODIFICATION EMAIL =====`)
    console.log(`📧 [EMAIL-${emailProcessId}] Recipient: ${data.clientEmail}`)
    console.log(`📧 [EMAIL-${emailProcessId}] New Booking Number: ${data.bookingNumber || "N/A"}`)
    console.log(`📧 [EMAIL-${emailProcessId}] Old Booking Number: ${data.oldBookingNumber || "N/A"}`)
    console.log(`📧 [EMAIL-${emailProcessId}] Source: ${data.source}`)
    console.log(`📧 [EMAIL-${emailProcessId}] Amount: ${data.newAmount} RON`)
    console.log(`📧 [EMAIL-${emailProcessId}] Difference: ${data.difference} RON`)

    const emailConfig = validateEmailConfig()
    if (!emailConfig.isValid) {
      return {
        success: false,
        error: `Email configuration missing: ${emailConfig.missingVars.join(", ")}`,
      }
    }

    const shouldHaveQrLink = data.source !== "pay_on_site" && !!data.bookingNumber
    if (shouldHaveQrLink && data.bookingNumber) {
      const signedQrApiUrl = buildSignedQrUrl(data.bookingNumber)
      if (signedQrApiUrl) {
        const base = getSiteBaseUrl()
        const u = new URL(signedQrApiUrl)
        const bn = u.searchParams.get("bookingNumber") || data.bookingNumber
        const sig = u.searchParams.get("sig") || ""
        data.qrLinkUrl = `${base}/qr?bookingNumber=${encodeURIComponent(bn)}&sig=${encodeURIComponent(sig)}`
      }
    } else {
      data.qrLinkUrl = undefined
    }

    const transporter = createEmailTransporter()
    const formattedBookingNumber = data.bookingNumber ? data.bookingNumber.padStart(6, "0") : data.licensePlate
    const mailOptions = {
      from: {
        name: "OTP Parking",
        address: process.env.GMAIL_USER || "noreply@rezervari.otp-parking.ro",
      },
      to: data.clientEmail,
      subject: `Rezervare modificată OTP Parking - ${formattedBookingNumber}`,
      html: generateBookingModificationConfirmationEmailHTML(data),
      attachments: [] as any[],
    }

    const sendStartTime = Date.now()
    const emailPromise = transporter.sendMail(mailOptions)
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("SMTP timeout - 30 seconds")), 30000)
    )
    const result = await Promise.race([emailPromise, timeoutPromise]) as any
    console.log(`✅ [EMAIL-${emailProcessId}] MODIFICATION EMAIL SENT in ${Date.now() - sendStartTime}ms`)

    return {
      success: true,
      messageId: result?.messageId,
      response: result?.response,
      qrIncluded: shouldHaveQrLink && !!data.qrLinkUrl,
    }
  } catch (error) {
    console.error(`❌ [EMAIL-${emailProcessId}] MODIFICATION EMAIL FAILED`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown email error",
      qrIncluded: data.source !== "pay_on_site" && !!data.bookingNumber,
    }
  }
}

/**
 * Generează HTML-ul pentru email-ul de confirmare
 */
export function generateBookingEmailHTML(bookingData: BookingEmailData): string {
  // Pentru pay-on-site nu avem booking number, pentru celelalte formatăm normal
  const formattedBookingNumber = bookingData.bookingNumber ? bookingData.bookingNumber.padStart(6, '0') : ''
  const isTestMode = bookingData.source === 'test_mode'
  const isPayOnSite = bookingData.source === 'pay_on_site'
  const qrLink = bookingData.qrLinkUrl || ''
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Confirmare Rezervare Parcare</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #ee7f1a, #d67016); color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }

        .header h1 { color: #ffffff; text-shadow: 2px 2px 4px rgba(0,0,0,0.3); margin: 10px 0; }
        .header p { color: #f0f8ff; font-size: 16px; margin: 5px 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .booking-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
        .detail-label { font-weight: bold; color: #666; }
        .detail-value { color: #333; }
        .qr-section { text-align: center; background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .qr-button { display: inline-block; background: #ee7f1a; color: white !important; padding: 12px 16px; border-radius: 8px; text-decoration: none; font-weight: bold; }
        .warning { background: #fff3cd; border: 1px solid #ffeaa7; color: #856404; padding: 15px; border-radius: 8px; margin: 20px 0; }
        .test-mode { background: #d1ecf1; border: 1px solid #bee5eb; color: #0c5460; padding: 15px; border-radius: 8px; margin: 20px 0; }
        .contact-section { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .contact-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
        .contact-item { text-align: center; padding: 10px; }
        .contact-item h4 { margin: 0 0 5px; color: #ee7f1a; font-size: 14px; }
        .contact-item p { margin: 0; font-size: 13px; }
        .footer { text-align: center; color: #666; font-size: 12px; margin-top: 30px; }
        @media (max-width: 600px) {
          .contact-grid { grid-template-columns: 1fr; gap: 10px; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🅿️ Confirmare Rezervare OTP Parking</h1>
          <p>Rezervarea dumneavoastră a fost confirmată cu succes!</p>
        </div>
        
        <div class="content">
          ${isTestMode ? `
            <div class="test-mode">
              <strong>⚠️ REZERVARE DE TEST</strong><br>
              Aceasta este o rezervare de test. Nu s-a procesat nicio plată.
            </div>
          ` : ''}
          
          <h2>Detalii Rezervare</h2>
          <div class="booking-details">
            ${!isPayOnSite ? `
            <div class="detail-row">
              <span class="detail-label">Număr Rezervare:</span>
              <span class="detail-value"><strong>${formattedBookingNumber}</strong></span>
            </div>
            ` : ''}
            <div class="detail-row">
              <span class="detail-label">Număr Înmatriculare:</span>
              <span class="detail-value">${bookingData.licensePlate}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Data Intrare:</span>
              <span class="detail-value">${bookingData.startDate} ${bookingData.startTime}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Data Ieșire:</span>
              <span class="detail-value">${bookingData.endDate} ${bookingData.endTime}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Durată:</span>
              <span class="detail-value">${bookingData.days} ${bookingData.days === 1 ? 'zi' : 'zile'}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Preț Total:</span>
              <span class="detail-value"><strong>${bookingData.amount.toFixed(2)} RON</strong>${bookingData.source === 'pay_on_site' ? '<br><small style="color: #ee7f1a; font-weight: bold;">Plata se va efectua la parcare cu cardul</small>' : ''}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Status:</span>
              <span class="detail-value">${isTestMode ? 'Confirmat (Test)' : 'Confirmat'}</span>
            </div>
          </div>
          
          ${isPayOnSite ? `
          <div class="qr-section">
            <h3>💳 Plată la Parcare cu cardul</h3>
            <div style="background: #fff3cd; border: 2px solid #ffeaa7; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <div style="text-align: center; font-size: 18px; font-weight: bold; color: #856404; margin-bottom: 10px;">
                🚗 Achitați direct la parcare!
              </div>
              <div style="text-align: center; font-size: 14px; color: #856404;">
                Prezentați-vă la sosire și plătiți ${bookingData.amount.toFixed(2)} RON la recepția parcării
              </div>
            </div>
          </div>
          ` : `
          <div class="qr-section">
            <h3>Cod QR pentru Acces</h3>
            <p>Pentru a accesa codul qr, acceseaza butonul de mai jos la sosirea la parcare.</p>
            ${qrLink ? `
              <p style="margin: 14px 0;">
                <a class="qr-button" href="${qrLink}">Generează / Deschide codul QR</a>
              </p>
              <p><small>Cod QR: MPK_RES=${formattedBookingNumber}</small></p>
              <p style="margin-top: 10px;">
                <a href="${qrLink}" style="color: #ee7f1a; text-decoration: underline;">
                  Dacă butonul nu funcționează, apăsați aici
                </a>
              </p>
            ` : `
              <p style="color:#b91c1c;"><strong>Link QR indisponibil momentan.</strong></p>
              <p><small>Cod rezervare: ${formattedBookingNumber}</small></p>
            `}
          </div>
          `}
          
          <div class="warning">
            <strong>⚠️ Importante:</strong><br>
            • Ora rezervării reprezintă ora estimată de sosire la parcare.<br>
            • Dacă ajungeți mai devreme, accesul în parcare este permis cu până la 2 ore înainte de ora rezervată.<br>
            • Vă rugăm să păstrați acest email și codul QR, deoarece sunt necesare pentru accesul în parcare.<br>
            • Anularea rezervării se poate face cu minimum 24 de ore înainte de ora rezervată.<br>
            • Pentru suport, vă rugăm să ne contactați folosind datele de mai jos.
          </div>
          
          <!-- Buton Anulare Rezervare -->
          <div style="text-align: center; margin: 30px 0;">
            <a href="https://rezervari.otp-parking.ro/anulare" 
               style="display: inline-block; background: #dc3545; color: white; padding: 15px 30px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: bold; box-shadow: 0 4px 6px rgba(220, 53, 69, 0.3);">
              🚫 Anulează
            </a>
            <p style="color: #666; font-size: 13px; margin-top: 10px;">
              Anularea se poate face cu minimum 24 ore înainte de sosire
            </p>
          </div>

          <div class="qr-section">
            <p style="margin: 0 0 16px 0; font-size: 15px;">
              Instalează aplicația OTP Parking și beneficiază de 25% reducere la rezervări, zile de parcare gratuite și multă flexibilitate.
            </p>
            <p style="margin: 0;">
              <a class="qr-button" href="https://www.otp-parking.ro/otp-parking-app">
                Vezi detalii și descarcă
              </a>
            </p>
          </div>

          <div class="contact-section">
            <h3 style="text-align: center; color: #ee7f1a; margin-bottom: 20px;">📞 Contactați-ne</h3>
            <div class="contact-grid">
              <div class="contact-item">
                <h4>📞 Telefon suport</h4>
                <p>0742.039.955</p>
              </div>
              <div class="contact-item">
                <h4>📧 Email suport</h4>
                <p>contact.parcareaeroport@gmail.com</p>
              </div>
              <div class="contact-item">
                <h4>🕒 Program</h4>
                <p><strong>Non-Stop</strong></p>
              </div>
              <div class="contact-item">
                <h4>📍 Locație</h4>
                <p>Str. Calea Bucureştilor, Nr.303A1</p>
                <p>Otopeni, Ilfov</p>
                <p><small>La 500 metri de Aeroportul Henri Coandă</small></p>
                <div style="margin-top: 10px; display: flex; gap: 8px; justify-content: center;">
                  <a href="https://maps.app.goo.gl/GhoVMNWvst6BamHx5?g_st=aw" 
                     style="display: inline-block; background: #ee7f1a; color: white; padding: 8px 12px; border-radius: 6px; text-decoration: none; font-size: 13px;">
                    📍 Google Maps
                  </a>
                  <a href="https://waze.com/ul?ll=44.575660,26.069918&navigate=yes" 
                     style="display: inline-block; background: #0099ff; color: white; padding: 8px 12px; border-radius: 6px; text-decoration: none; font-size: 13px;">
                    🚗 Waze
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div class="footer">
          <p>Acest email a fost trimis automat de sistemul OTP Parking.</p>
          <p>Rezervarea a fost creată la: ${bookingData.createdAt.toLocaleString('ro-RO')}</p>
          <p style="margin-top: 10px;">
            <strong>OTP Parking SRL</strong> | 
                          Str. Calea Bucureştilor, Nr.303A1, Otopeni, Ilfov | 
            contact.parcareaeroport@gmail.com
          </p>
        </div>
      </div>
    </body>
    </html>
  `
}

/**
 * Trimite email de confirmare rezervare cu QR code
 */
export async function sendBookingConfirmationEmail(
  bookingData: BookingEmailData
): Promise<{
  success: boolean
  error?: string
  messageId?: string
  response?: string
  qrIncluded?: boolean
  qrBytes?: number
}> {
  // Pentru pay-on-site folosim licensePlate în loc de bookingNumber în emailProcessId
  const bookingRef = bookingData.bookingNumber || `pay_on_site_${bookingData.licensePlate}`
  const emailProcessId = `${bookingRef}_${Date.now()}`
  
  try {
    console.log(`📧 [EMAIL-${emailProcessId}] ===== STARTING EMAIL PROCESS =====`)
    console.log(`📧 [EMAIL-${emailProcessId}] Recipient: ${bookingData.clientEmail}`)
    console.log(`📧 [EMAIL-${emailProcessId}] Booking Number: ${bookingData.bookingNumber}`)
    console.log(`📧 [EMAIL-${emailProcessId}] License Plate: ${bookingData.licensePlate}`)
    console.log(`📧 [EMAIL-${emailProcessId}] Source: ${bookingData.source}`)
    console.log(`📧 [EMAIL-${emailProcessId}] Status: ${bookingData.status}`)
    console.log(`📧 [EMAIL-${emailProcessId}] Amount: ${bookingData.amount} RON`)
    console.log(`📧 [EMAIL-${emailProcessId}] Days: ${bookingData.days}`)
    console.log(`📧 [EMAIL-${emailProcessId}] Start: ${bookingData.startDate} ${bookingData.startTime}`)
    console.log(`📧 [EMAIL-${emailProcessId}] End: ${bookingData.endDate} ${bookingData.endTime}`)
    console.log(`📧 [EMAIL-${emailProcessId}] Timestamp: ${new Date().toISOString()}`)
    
    // Validare configurație email
    const emailConfig = validateEmailConfig()
    if (!emailConfig.isValid) {
      console.error(`❌ [EMAIL-${emailProcessId}] Email configuration invalid!`)
      console.error(`❌ [EMAIL-${emailProcessId}] Missing variables: ${emailConfig.missingVars.join(', ')}`)
      return { 
        success: false, 
        error: `Email configuration missing: ${emailConfig.missingVars.join(', ')}` 
      }
    }
    console.log(`✅ [EMAIL-${emailProcessId}] Email configuration validated`)
    console.log(`📧 [EMAIL-${emailProcessId}] Gmail User: ${process.env.GMAIL_USER ? 'SET' : 'NOT SET'}`)
    console.log(`📧 [EMAIL-${emailProcessId}] Gmail Password: ${process.env.GMAIL_APP_PASSWORD ? 'SET (length=' + process.env.GMAIL_APP_PASSWORD.length + ')' : 'NOT SET'}`)
    
    // IMPORTANT: No QR attachments/inline images (deliverability).
    // We only include a link that generates the QR on demand.
    const shouldHaveQrLink = bookingData.source !== "pay_on_site" && !!bookingData.bookingNumber
    const qrIncluded = false
    if (shouldHaveQrLink && bookingData.bookingNumber) {
      const signedQrApiUrl = buildSignedQrUrl(bookingData.bookingNumber)
      if (signedQrApiUrl) {
        // Link to a human-friendly page that loads /api/qr underneath
        const base = getSiteBaseUrl()
        const u = new URL(signedQrApiUrl)
        const bn = u.searchParams.get("bookingNumber") || bookingData.bookingNumber
        const sig = u.searchParams.get("sig") || ""
        bookingData.qrLinkUrl = `${base}/qr?bookingNumber=${encodeURIComponent(bn)}&sig=${encodeURIComponent(sig)}`
        console.log(`🔗 [EMAIL-${emailProcessId}] QR link prepared (no attachment)`)
      } else {
        // Development-only: allow /api/qr bypass with sig=dev (see app/api/qr/route.ts)
        if (process.env.NODE_ENV === "development") {
          const base = getSiteBaseUrl()
          bookingData.qrLinkUrl = `${base}/qr?bookingNumber=${encodeURIComponent(bookingData.bookingNumber)}&sig=dev`
          console.warn(`⚠️ [EMAIL-${emailProcessId}] QR_LINK_SECRET missing; using development QR link (sig=dev).`)
        } else {
          console.warn(`⚠️ [EMAIL-${emailProcessId}] QR link not available (QR_LINK_SECRET missing). Email will be sent without QR link.`)
          bookingData.qrLinkUrl = undefined
        }
      }
    } else {
      bookingData.qrLinkUrl = undefined
    }
    
    // Nu mai folosim logo în email pentru a reduce complexitatea și dimensiunea bundle-ului
    console.log(`📧 [EMAIL-${emailProcessId}] Skipping logo loading - email will be sent without logo`)
    
    // Creează transporterul email
    console.log(`🚀 [EMAIL-${emailProcessId}] Creating email transporter...`)
    const transporter = createEmailTransporter()
    console.log(`✅ [EMAIL-${emailProcessId}] Email transporter created`)
    
    // Configurează email-ul
    // Pentru pay-on-site nu avem booking number, folosim licensePlate pentru nume fișiere
    const formattedBookingNumber = bookingData.bookingNumber ? bookingData.bookingNumber.padStart(6, '0') : bookingData.licensePlate
    const attachments: any[] = []
    
    const mailOptions = {
      from: {
        name: 'OTP Parking',
        address: process.env.GMAIL_USER || 'noreply@rezervari.otp-parking.ro'
      },
      to: bookingData.clientEmail,
      subject: `Confirmare Rezervare OTP Parking - ${formattedBookingNumber}`,
      html: generateBookingEmailHTML(bookingData),
      attachments: attachments
    }
    
    console.log(`📧 [EMAIL-${emailProcessId}] Email options configured:`)
    console.log(`📧 [EMAIL-${emailProcessId}]   From: ${mailOptions.from.name} <${mailOptions.from.address}>`)
    console.log(`📧 [EMAIL-${emailProcessId}]   To: ${mailOptions.to}`)
    console.log(`📧 [EMAIL-${emailProcessId}]   Subject: ${mailOptions.subject}`)
    console.log(`📧 [EMAIL-${emailProcessId}]   HTML Length: ${mailOptions.html.length} chars`)
    console.log(`📧 [EMAIL-${emailProcessId}]   Attachments: ${mailOptions.attachments.length} files`)
    console.log(`📧 [EMAIL-${emailProcessId}]   QR link included: ${bookingData.qrLinkUrl ? "YES" : "NO"}`)
    console.log(`📧 [EMAIL-${emailProcessId}]   Logo Attachment: No logo attached`)
    
    // Trimite email-ul cu timeout
    console.log(`🚀 [EMAIL-${emailProcessId}] Sending email via Gmail SMTP...`)
    const sendStartTime = Date.now()
    
    // Timeout de 30 secunde pentru SMTP
    const emailPromise = transporter.sendMail(mailOptions)
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('SMTP timeout - 30 seconds')), 30000)
    )
    
    const result = await Promise.race([emailPromise, timeoutPromise]) as any
    const sendDuration = Date.now() - sendStartTime
    
    console.log(`✅ [EMAIL-${emailProcessId}] ===== EMAIL SENT SUCCESSFULLY =====`)
    console.log(`✅ [EMAIL-${emailProcessId}] Message ID: ${result.messageId}`)
    console.log(`✅ [EMAIL-${emailProcessId}] Response: ${result.response}`)
    console.log(`✅ [EMAIL-${emailProcessId}] Send Duration: ${sendDuration}ms`)
    console.log(`✅ [EMAIL-${emailProcessId}] Final Status: SUCCESS`)
    console.log(`✅ [EMAIL-${emailProcessId}] Timestamp: ${new Date().toISOString()}`)
    console.log(`✅ [EMAIL-${emailProcessId}] Recipient Confirmed: ${bookingData.clientEmail}`)
    console.log(`✅ [EMAIL-${emailProcessId}] Booking Confirmed: ${formattedBookingNumber}`)
    
    return {
      success: true,
      messageId: result?.messageId,
      response: result?.response,
      qrIncluded,
      qrBytes: 0,
    }
    
  } catch (error) {
    console.error(`❌ [EMAIL-${emailProcessId}] ===== EMAIL FAILED =====`)
    console.error(`❌ [EMAIL-${emailProcessId}] Error Type: ${error instanceof Error ? error.constructor.name : typeof error}`)
    console.error(`❌ [EMAIL-${emailProcessId}] Error Message: ${error instanceof Error ? error.message : String(error)}`)
    console.error(`❌ [EMAIL-${emailProcessId}] Error Code: ${(error as any)?.code || 'N/A'}`)
    console.error(`❌ [EMAIL-${emailProcessId}] Error Errno: ${(error as any)?.errno || 'N/A'}`)
    console.error(`❌ [EMAIL-${emailProcessId}] Error Syscall: ${(error as any)?.syscall || 'N/A'}`)
    console.error(`❌ [EMAIL-${emailProcessId}] Error Stack:`, error instanceof Error ? error.stack : 'N/A')
    console.error(`❌ [EMAIL-${emailProcessId}] Timestamp: ${new Date().toISOString()}`)
    console.error(`❌ [EMAIL-${emailProcessId}] Target Email: ${bookingData.clientEmail}`)
    console.error(`❌ [EMAIL-${emailProcessId}] Booking Number: ${bookingData.bookingNumber}`)
    console.error(`❌ [EMAIL-${emailProcessId}] Gmail User Config: ${process.env.GMAIL_USER ? 'SET' : 'NOT SET'}`)
    console.error(`❌ [EMAIL-${emailProcessId}] Gmail Pass Config: ${process.env.GMAIL_APP_PASSWORD ? 'SET' : 'NOT SET'}`)
    
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown email error',
      qrIncluded: bookingData.source !== 'pay_on_site' && !!bookingData.bookingNumber
    }
  }
}

/**
 * Validează configurația email
 */
export function validateEmailConfig(): { isValid: boolean, missingVars: string[] } {
  const requiredVars = ['GMAIL_USER', 'GMAIL_APP_PASSWORD']
  const missingVars = requiredVars.filter(varName => !process.env[varName])
  
  return {
    isValid: missingVars.length === 0,
    missingVars
  }
} 
