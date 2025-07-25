import { NextRequest, NextResponse } from "next/server"
import nodemailer from "nodemailer"

interface CancellationData {
  firstName: string
  lastName: string
  phone: string
  email: string
  bookingNumber: string
  licensePlate: string
  reservationPeriod: string
}

function createEmailTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  })
}

function generateCancellationEmailHTML(data: CancellationData): string {
  return `
    <!DOCTYPE html>
    <html lang="ro">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Cerere Anulare Rezervare</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px; background-color: #f5f5f5; }
        .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        .header { background: linear-gradient(135deg, #ee7f1a, #d67016); color: white; padding: 20px; text-align: center; }
        .header h1 { color: #ffffff; margin: 0; font-size: 24px; }
        .content { padding: 30px; }
        .details-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        .details-table th, .details-table td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        .details-table th { background-color: #f8f9fa; font-weight: 600; color: #495057; }
        .highlight { background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 5px; padding: 15px; margin: 20px 0; }
        .footer { background-color: #f8f9fa; padding: 20px; text-align: center; color: #666; font-size: 14px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🚫 Cerere Anulare Rezervare</h1>
          <p>O nouă cerere de anulare a fost primită</p>
        </div>
        
        <div class="content">
          <div class="highlight">
            <strong>⚠️ CERERE DE ANULARE REZERVARE</strong><br>
            Un client a solicitat anularea rezervării prin formularul online.
          </div>
          
          <h2>Detalii Client</h2>
          <table class="details-table">
            <tr>
              <th>Nume complet</th>
              <td>${data.firstName} ${data.lastName}</td>
            </tr>
            <tr>
              <th>Telefon</th>
              <td>${data.phone}</td>
            </tr>
            <tr>
              <th>Email</th>
              <td>${data.email}</td>
            </tr>
          </table>
          
          <h2>Detalii Rezervare</h2>
          <table class="details-table">
            <tr>
              <th>Număr rezervare</th>
              <td><strong>${data.bookingNumber}</strong></td>
            </tr>
            <tr>
              <th>Număr înmatriculare</th>
              <td><strong>${data.licensePlate}</strong></td>
            </tr>
            <tr>
              <th>Perioada rezervării</th>
              <td>${data.reservationPeriod}</td>
            </tr>
          </table>
          
          <div class="highlight">
            <strong>📋 Acțiuni necesare:</strong><br>
            • Verificați rezervarea în sistem<br>
            • Contactați clientul pentru confirmare<br>
            • Procesați rambursarea în maxim 7 zile lucrătoare<br>
            • Anulați rezervarea în sistem
          </div>
        </div>
        
        <div class="footer">
          <p>Această cerere a fost trimisă automat de pe site-ul Parcare-Aeroport Otopeni.</p>
          <p>Data și ora: ${new Date().toLocaleString('ro-RO')}</p>
        </div>
      </div>
    </body>
    </html>
  `
}

export async function POST(request: NextRequest) {
  try {
    const data: CancellationData = await request.json()
    
    // Validare date
    const { firstName, lastName, phone, email, bookingNumber, licensePlate, reservationPeriod } = data
    
    if (!firstName || !lastName || !phone || !email || !bookingNumber || !licensePlate || !reservationPeriod) {
      return NextResponse.json(
        { error: "Toate câmpurile sunt obligatorii" },
        { status: 400 }
      )
    }

    // Verifică configurația email
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
      console.error("Missing email configuration")
      return NextResponse.json(
        { error: "Configurație email lipsă" },
        { status: 500 }
      )
    }

    // Creează transporterul email
    const transporter = createEmailTransporter()
    
    // Configurează email-ul
    const mailOptions = {
      from: {
        name: 'OTP Parking - Anulări',
        address: process.env.GMAIL_USER
      },
      to: process.env.GMAIL_USER, // Trimite către adresa companiei
      subject: `🚫 Cerere Anulare Rezervare #${bookingNumber} - ${licensePlate}`,
      html: generateCancellationEmailHTML(data),
      replyTo: email // Pentru a putea răspunde direct clientului
    }
    
    // Log înainte de trimitere
    console.log(`📧 Attempting to send cancellation request for booking ${bookingNumber}`)
    console.log(`   📧 From: ${process.env.GMAIL_USER}`)
    console.log(`   📧 To: ${process.env.GMAIL_USER}`)
    console.log(`   📧 Client: ${firstName} ${lastName} (${email})`)
    console.log(`   📧 License Plate: ${licensePlate}`)
    console.log(`   📧 Timestamp: ${new Date().toISOString()}`)
    
    // Trimite email-ul
    const emailResult = await transporter.sendMail(mailOptions)
    
    // Log detaile de succes
    console.log(`✅ CANCELLATION EMAIL SENT SUCCESSFULLY!`)
    console.log(`   ✅ Message ID: ${emailResult.messageId}`)
    console.log(`   ✅ Response: ${emailResult.response}`)
    console.log(`   ✅ Booking Number: ${bookingNumber}`)
    console.log(`   ✅ Client Email: ${email}`)
    console.log(`   ✅ Sent to: ${process.env.GMAIL_USER}`)
    console.log(`   ✅ Timestamp: ${new Date().toLocaleString('ro-RO')}`)
    console.log(`   ✅ Status: EMAIL DELIVERED`)
    
    return NextResponse.json(
      { 
        message: "Cererea de anulare a fost trimisă cu succes",
        messageId: emailResult.messageId,
        timestamp: new Date().toISOString()
      },
      { status: 200 }
    )
    
  } catch (error) {
    // Log detaile erorii pentru debugging
    console.error('❌ CANCELLATION EMAIL FAILED!')
    console.error(`   ❌ Error Type: ${error instanceof Error ? error.name : 'Unknown'}`)
    console.error(`   ❌ Error Message: ${error instanceof Error ? error.message : 'Unknown error'}`)
    console.error(`   ❌ Full Error:`, error)
    console.error(`   ❌ Timestamp: ${new Date().toLocaleString('ro-RO')}`)
    console.error(`   ❌ Gmail User: ${process.env.GMAIL_USER ? 'SET' : 'NOT SET'}`)
    console.error(`   ❌ Gmail Password: ${process.env.GMAIL_APP_PASSWORD ? 'SET' : 'NOT SET'}`)
    
    return NextResponse.json(
      { 
        error: "Eroare la trimiterea cererii de anulare",
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    )
  }
} 