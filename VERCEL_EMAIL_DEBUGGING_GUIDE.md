# 🔍 Ghid Debugging Email-uri pe Vercel vs Local

## 📋 Problema Identificată

**Simptom**: Email-urile se trimit când rulezi `npm run dev` local, dar nu se trimit când aplicația este live pe Vercel.

**Cauza**: Procesele background pe Vercel serverless functions se termină prematur când funcția principală returnează răspunsul.

## ✅ Soluția Implementată

### 1. **API Endpoint Dedicat pentru Email** 
Creat: `/api/send-confirmation-email`
- Rulează sincron pe Vercel
- Nu se întrerupe ca procesele background
- Tracking complet în Firestore

### 2. **Procesare Sincrona în `booking-actions.ts`**
- Înlocuit `processQRAndEmailAsync` (background) cu apel API sincron
- Funcționează atât local cât și pe Vercel
- Logging detaliat pentru debugging

### 3. **Logging Îmbunătățit**
- Process ID-uri unice pentru tracking
- Timestamp-uri precise
- Separare mediu local vs producție

## 🔧 Verificări Immediate

### **Pas 1: Verifică Configurația Email pe Vercel**
```bash
# Accsează în browser:
https://parcare-aeroport.ro/api/check-email-config
```

**Verifică că afișează**:
- ✅ `gmailUser: "SET"`
- ✅ `gmailPassword: "SET"`
- ✅ `gmailPasswordLength: 16` (sau mărimea parolei tale)

### **Pas 2: Testează Endpoint-ul de Email Direct**
```bash
# Testează direct API-ul de email:
curl -X POST https://parcare-aeroport.ro/api/send-confirmation-email \
  -H "Content-Type: application/json" \
  -d '{
    "bookingData": {
      "bookingNumber": "123456",
      "clientName": "Test User",
      "clientEmail": "test@example.com",
      "licensePlate": "B123TST",
      "startDate": "2024-01-01",
      "startTime": "10:00",
      "endDate": "2024-01-02",
      "endTime": "10:00",
      "days": 1,
      "amount": 50,
      "status": "confirmed_pay_on_site",
      "source": "pay_on_site"
    },
    "firestoreId": "test-firestore-id"
  }'
```

### **Pas 3: Monitorizează Logs-urile în Timp Real**
```bash
# Instalează Vercel CLI
npm install -g vercel

# Login în Vercel
vercel login

# Monitorizează logs în timp real
vercel logs --follow
```

## 🔍 Keywords pentru Debugging în Vercel Logs

### **Pentru Pay-on-Site:**
- `🚀 [PAY_ON_SITE_` - Începutul procesului
- `📧 [PAY_ON_SITE_` - Procesarea email-ului
- `✅ [PAY_ON_SITE_` - Succes
- `❌ [PAY_ON_SITE_` - Eroare

### **Pentru API-ul de Email:**
- `📧 [API_EMAIL_` - Procesul de email prin API
- `📧 [EMAIL-` - Procesul intern de email
- `✅ Email sent successfully` - Email trimis
- `❌ Email failed` - Email eșuat

### **Pentru Webhook Stripe:**
- `🌐 [WEBHOOK_` - Procesul webhook
- `📧 Email will be sent` - Email planificat
- `✅ Email API success` - Email trimis cu succes

## 📊 Verificări Pas cu Pas

### **Scenario 1: Pay-on-Site Rezervare**

1. **Accesează aplicația** → Formular rezervare
2. **Completează datele** → Alege "Plată la parcare"
3. **Monitorizează browser console** pentru:
   ```javascript
   🚀 [PAY_ON_SITE_xxxxx] ===== PAY ON SITE PROCESS STARTED =====
   📧 [PAY_ON_SITE_xxxxx] Email will be sent automatically to: email@example.com
   ✅ [PAY_ON_SITE_xxxxx] ===== BOOKING CONFIRMED =====
   ```

4. **Monitorizează Vercel logs** pentru:
   ```
   📧 [API_EMAIL_xxxxx] ===== EMAIL API ENDPOINT CALLED =====
   📧 [EMAIL-xxxxx] ===== STARTING EMAIL PROCESS =====
   ✅ [EMAIL-xxxxx] ===== EMAIL SENT SUCCESSFULLY =====
   ```

### **Scenario 2: Webhook Stripe**

1. **Fă o plată reală** prin Stripe
2. **Monitorizează Vercel logs** pentru:
   ```
   🌐 [WEBHOOK_xxxxx] ===== WEBHOOK PROCESSING =====
   📧 Calling email API endpoint for booking xxxxx
   ✅ Email API success for booking xxxxx
   ```

## 🛠️ Troubleshooting Common Issues

### **❌ Email Configuration Invalid**
```bash
# Verifică în Vercel Dashboard → Settings → Environment Variables
GMAIL_USER=your-email@gmail.com
GMAIL_APP_PASSWORD=your-16-digit-app-password
```

### **❌ Gmail Authentication Error**
- Verifică că ai **2-Step Verification** activat
- Generează o nouă **App Password** din Google Account
- Folosește **App Password** (nu parola normală)

### **❌ QR Code Generation Error**
- Verifică că pachetul `qrcode` este instalat
- Verifică că booking number-ul există

### **❌ Firestore Connection Error**
- Verifică Firebase environment variables
- Verifică conexiunea la Firestore

## 📈 Testare Automată

### **Test Script pentru Email**
```javascript
// Salvează ca test-email.js
const testEmail = async () => {
  const response = await fetch('https://parcare-aeroport.ro/api/send-confirmation-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bookingData: {
        bookingNumber: '123456',
        clientName: 'Test User',
        clientEmail: 'your-email@gmail.com', // Înlocuiește cu email-ul tău
        licensePlate: 'B123TST',
        startDate: '2024-01-01',
        startTime: '10:00',
        endDate: '2024-01-02',
        endTime: '10:00',
        days: 1,
        amount: 50,
        status: 'confirmed_pay_on_site',
        source: 'pay_on_site'
      },
      firestoreId: 'test-id'
    })
  })
  
  const result = await response.json()
  console.log('Email test result:', result)
}

testEmail()
```

## 📞 Support Quick Actions

### **Dacă email-urile încă nu se trimit:**

1. **Verifică Vercel Environment Variables**:
   - Mergi la Vercel Dashboard → Project → Settings → Environment Variables
   - Verifică că `GMAIL_USER` și `GMAIL_APP_PASSWORD` sunt setate

2. **Regenerează Gmail App Password**:
   - Google Account → Security → 2-Step Verification → App passwords
   - Generează nou password și actualizează în Vercel

3. **Testează cu email-ul tău**:
   - Modifică temporary `GMAIL_USER` să fie email-ul tău
   - Testează o rezervare pay-on-site
   - Verifică dacă primești email-ul

4. **Activează Detailed Logging**:
   ```javascript
   // În lib/email-service.ts, linia 44
   debug: true,    // Schimbă din false în true
   logger: true,   // Schimbă din false în true
   ```

## 🎯 Success Indicators

### **Email-ul funcționează când vezi:**
- ✅ Browser console: `✅ Email sent successfully`
- ✅ Vercel logs: `✅ EMAIL SENT SUCCESSFULLY`
- ✅ Firestore: `emailStatus: "sent"`
- ✅ Client primește email cu QR code

### **Email-ul nu funcționează când vezi:**
- ❌ Browser console: `⚠️ Email API failed`
- ❌ Vercel logs: `❌ EMAIL FAILED`
- ❌ Firestore: `emailStatus: "failed"`
- ❌ Client nu primește email

## 🚀 Next Steps

Dacă problema persistă după aceste verificări, următoarele opțiuni sunt disponibile:

1. **Implementare SendGrid** (recomandat pentru producție)
2. **Queue System cu Cron Jobs** (pentru volume mari)
3. **Email service extern** (Mailgun, AWS SES)

---

**Ultima actualizare**: ${new Date().toISOString()}
**Versiune**: 2.0 (Sincron API Email) 