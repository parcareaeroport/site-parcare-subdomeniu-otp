// Notă: Trebuie instalat pachetul: npm install qrcode @types/qrcode

/**
 * Generează un cod QR pentru Multipark cu formatul exact MPK_RES=xxxxxx
 * @param bookingNumber - Numărul de rezervare (maximum 6 cifre)
 * @returns Promise<string> - Base64 data URL pentru QR code
 */
export async function generateMultiparkQR(bookingNumber: string): Promise<string> {
  // Importul dinamic pentru a evita erori de build
  const QRCode = await import('qrcode')
  
  // Formatează booking number-ul să aibă exact 6 cifre cu zero-uri în față
  const formattedBookingNumber = bookingNumber.padStart(6, '0')
  
  // Creează conținutul QR code-ului în formatul oficial Multipark
  const qrContent = `MPK_RES=${formattedBookingNumber}`
  
  console.log(`Generating QR code with content: ${qrContent}`)
  
  try {
    // Generează QR code-ul ca base64 data URL cu opțiuni compatibile
    const qrCodeDataUrl = await QRCode.toDataURL(qrContent, {
      errorCorrectionLevel: 'M',
      margin: 1,
      color: {
        dark: '#000000',  // Culoare neagră pentru cod
        light: '#FFFFFF'  // Fundal alb
      },
      width: 256  // Dimensiune optimă pentru scanare
    })
    
    console.log(`QR code generated successfully for booking: ${formattedBookingNumber}`)
    return qrCodeDataUrl
    
  } catch (error) {
    console.error('Error generating QR code:', error)
    throw new Error(`Failed to generate QR code for booking ${bookingNumber}`)
  }
}

/**
 * Validează formatul booking number-ului pentru Multipark
 * @param bookingNumber - Numărul de rezervare
 * @returns boolean - True dacă formatul este valid
 */
export function validateBookingNumber(bookingNumber: string): boolean {
  // Verifică că este un număr și are maximum 6 cifre
  const numberRegex = /^\d{1,6}$/
  return numberRegex.test(bookingNumber)
}

/**
 * Generează QR code-ul ca Buffer pentru salvare în fișier
 * @param bookingNumber - Numărul de rezervare
 * @returns Promise<Buffer> - Buffer cu imaginea QR code
 */
export async function generateMultiparkQRBuffer(bookingNumber: string): Promise<Buffer> {
  const QRCode = await import('qrcode')
  
  const formattedBookingNumber = bookingNumber.padStart(6, '0')
  const qrContent = `MPK_RES=${formattedBookingNumber}`
  
  try {
    const qrBuffer = await QRCode.toBuffer(qrContent, {
      errorCorrectionLevel: 'M',
      margin: 1,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      },
      width: 256
    })
    
    return qrBuffer
    
  } catch (error) {
    console.error('Error generating QR code buffer:', error)
    throw new Error(`Failed to generate QR code buffer for booking ${bookingNumber}`)
  }
} 