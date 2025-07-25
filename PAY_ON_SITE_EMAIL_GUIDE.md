# 📧 Ghid Email-uri Rezervări Pay-on-Site

## ✅ Modificări Implementate

Am creat un sistem de email-uri diferențiat pentru rezervările cu "plată la parcare":

### **📋 Diferențele față de rezervările cu plată:**

#### **1. Status**
- **Cu plată**: "Confirmat" 
- **Pay-on-site**: "Confirmat" (fără "plătit")

#### **2. Secțiunea QR Code**
- **Cu plată**: 
  - Titlu: "Cod QR pentru Acces"
  - Afișează codul QR scanabil
  - Text: "Pentru accesul în parcare puteți folosi codul QR de mai jos!"

- **Pay-on-site**:
  - Titlu: "💳 Plată la Parcare"
  - Afișează mesaj highlighted: "🚗 Achitați direct la parcare!"
  - Text: "Prezentați-vă la sosire și plătiți X.XX RON la recepția parcării"

#### **3. Instrucțiuni Importante**
- **Cu plată**: Include "• Păstrați acest email și codul QR pentru accesul la parcare"
- **Pay-on-site**: Elimină linia cu QR code-ul din instrucțiuni

#### **4. Atașamente Email**
- **Cu plată**: Include fișierul QR code PNG
- **Pay-on-site**: Nu include QR code (reduce dimensiunea email-ului)

## 🔧 Implementare Tehnică

### **Condiții în Template:**
```typescript
const isPayOnSite = bookingData.source === 'pay_on_site'

// Secțiunea QR
${isPayOnSite ? `
  <div class="qr-section">
    <h3>💳 Plată la Parcare</h3>
    <div style="background: #fff3cd; border: 2px solid #ffeaa7;">
      🚗 Achitați direct la parcare!
    </div>
  </div>
` : `
  <div class="qr-section">
    <h3>Cod QR pentru Acces</h3>
    <img src="cid:qrcode" alt="QR Code" />
  </div>
`}

// Instrucțiuni
${isPayOnSite ? '' : '• Păstrați acest email și codul QR pentru accesul la parcare<br>'}
```

### **Generare QR Code:**
```typescript
// Generează QR doar pentru rezervări cu plată
let qrBuffer: Buffer | null = null
if (bookingData.source !== 'pay_on_site') {
  qrBuffer = await generateMultiparkQRBuffer(bookingData.bookingNumber)
}

// Atașamente condiționale
const attachments: any[] = []
if (qrBuffer !== null) {
  attachments.push({
    filename: `qr-code-${formattedBookingNumber}.png`,
    content: qrBuffer,
    cid: 'qrcode'
  })
}
```

## 🧪 Testare

### **Preview Email-uri:**

**1. Rezervare Pay-on-Site:**
```
http://localhost:3000/api/test-pay-on-site-email
```

**2. Rezervare cu Plată (pentru comparație):**
```
http://localhost:3000/api/test-paid-email
```

### **Test Real Pay-on-Site:**
1. Accesează aplicația → Formular rezervare
2. Completează datele și alege "Plată la parcare"
3. Folosește parola de developer: `1234567890`
4. Verifică email-ul primit

## 📊 Structura Email Pay-on-Site

```html
🅿️ Confirmare Rezervare OTP Parking
Rezervarea dumneavoastră a fost confirmată cu succes!

┌─ Detalii Rezervare ─────────────────────────┐
│ Număr Rezervare: 000123                     │
│ Număr Înmatriculare: B123TST                │
│ Data Intrare: 15 ianuarie 2024 ora 10:00    │
│ Data Ieșire: 17 ianuarie 2024 ora 10:00     │
│ Durată: 2 zile                              │
│ Preț Total: 100.00 RON                     │
│ Status: Confirmat                           │
└─────────────────────────────────────────────┘

┌─ 💳 Plată la Parcare ──────────────────────┐
│         🚗 Achitați direct la parcare!      │
│   Prezentați-vă la sosire și plătiți       │
│        100.00 RON la recepția parcării     │
└─────────────────────────────────────────────┘

⚠️ Importante:
• Prezentați-vă cu maximum 2 ore înainte de ora rezervată
• Anularea se poate face cu minimum 24 ore înainte
• Pentru suport, contactați-ne folosind datele de mai jos

[🚫 Anulează rezervarea]

📞 Contactați-ne
📞 0742.039.955 | 📧 contact.parcareaeroport@gmail.com
📍 Str. Calea Bucureştilor, Nr.303A1, Otopeni, Ilfov
```

## 📈 Beneficii

### **Performance:**
- ✅ Email-uri mai mici (fără QR PNG)
- ✅ Procesare mai rapidă (nu generează QR)
- ✅ Debugging mai ușor

### **UX:**
- ✅ Mesaj clar despre plata la sosire
- ✅ Eliminat confuzia cu QR code-ul
- ✅ Instrucțiuni specifice pentru pay-on-site

### **Diferențiere Clară:**
- ✅ Design distinct pentru cele două tipuri
- ✅ Highlight vizual pentru plata la parcare
- ✅ Instrucțiuni adaptate pentru fiecare tip

## 🚀 Deployment

Modificările sunt implementate în:
- ✅ `lib/email-service.ts` - Template-ul principal
- ✅ `app/api/test-pay-on-site-email/route.ts` - Preview pay-on-site
- ✅ `app/api/test-paid-email/route.ts` - Preview cu plată

**Urmează:**
1. Deploy pe Vercel
2. Test email real cu pay-on-site
3. Verificare în inbox pentru design

---

**Ultima actualizare**: ${new Date().toISOString()}
**Versiune**: 1.0 (Pay-on-Site Email Templates) 