# 🧪 Ghid Complet pentru Testarea Erorilor de Plată

## 📋 **Răspunsuri la Întrebări**

### ❓ **Avem pagină de redirectionare pentru erori?**
✅ **DA** - Am creat pagina dedicată `/payment-error` cu:
- Afișare detaliată pentru fiecare tip de eroare
- Sugestii specifice pentru rezolvare  
- Butoane pentru reîncercare sau rezervare nouă
- Informații de contact pentru suport

### ❓ **Cum imităm plăți eșuate fără fonduri insuficiente?**
✅ **Multiple modalități** - Stripe oferă carduri de test pentru toate scenariile:

---

## 🎯 **Carduri de Test pentru Plăți Eșuate**

### 1. **Eșecuri Bancare**
```javascript
// Card refuzat generic
Card: 4000000000000002
Error: card_declined
Decline: generic_decline

// Fonduri insuficiente  
Card: 4000000000009995
Error: card_declined
Decline: insufficient_funds

// Card pierdut
Card: 4000000000009987
Error: card_declined
Decline: lost_card

// Card furat
Card: 4000000000009979
Error: card_declined
Decline: stolen_card
```

### 2. **Erori de Date**
```javascript
// Card expirat
Card: 4000000000000069
Error: expired_card

// CVC incorect (trebuie să introduci CVC în formular)
Card: 4000000000000127  
Error: incorrect_cvc

// Număr card greșit (ultima cifră modificată)
Card: 4242424242424241
Error: incorrect_number
```

### 3. **Erori de Procesare**
```javascript
// Eroare temporară de procesare
Card: 4000000000000119
Error: processing_error

// Depășire limită de velocitate
Card: 4000000000006975
Error: card_declined
Decline: card_velocity_exceeded
```

### 4. **Radar/Fraud Prevention**
```javascript
// Întotdeauna blocat (risc maxim)
Card: 4100000000000019
Error: card_declined
Outcome: blocked

// Risc crescut (poate fi blocat)
Card: 4000000000004954
Error: card_declined
Risk: highest

// CVC check eșuează
Card: 4000000000000101
Error: card_declined
Issue: cvc_check_fails
```

---

## 🛠 **Cum să Testezi Plăți Eșuate**

### **Opțiunea 1: Testare Manuală în Browser**

1. **Mergi la checkout**: `/plasare-comanda`
2. **Completează formularul** cu date valide
3. **Folosește un card de test din lista de mai sus**:
   ```
   Număr: 4000000000000002 (pentru generic decline)
   Data: 12/34 (orice dată viitoare)
   CVC: 123 (orice 3 cifre)
   ```
4. **Apasă "Plătește acum"**
5. **Vei fi redirectat** la `/payment-error` cu detalii specifice

### **Opțiunea 2: Script Automat**

```bash
# Rulează scriptul nostru de test
node scripts/test-failed-payments.js

# Sau testează un singur tip de eroare
node scripts/test-failed-payments.js insufficient_funds
```

### **Opțiunea 3: Testare cu URL-uri Directe**

Poți testa pagina de eroare direct:
```
http://localhost:3000/payment-error?code=card_declined&message=Test%20error
http://localhost:3000/payment-error?code=insufficient_funds&message=Fonduri%20insuficiente
http://localhost:3000/payment-error?code=expired_card&message=Card%20expirat
```

---

## 🎬 **Fluxul de Erori în Aplicație**

### **Scenariul 1: Eroare în Checkout Form**
```
User completează formular → 
User apasă "Plătește" →
Stripe confirmPayment() FAILS →
Redirect către /payment-error?code=...&message=...
```

### **Scenariul 2: Eroare pe Pagina de Confirmare**  
```
User vine la /confirmare din Stripe →
retrievePaymentIntent() returns failed status →
Redirect către /payment-error?code=...&message=...
```

### **Scenariul 3: Webhook Failure**
```
Plata reușește la Stripe →
Webhook primește payment_intent.payment_failed →
Se loggează eroarea (nu salvează rezervarea)
```

---

## 🎯 **Ce se Testează pentru Fiecare Tip de Eroare**

| **Tip Eroare** | **Card Test** | **Mesaj Așteptat** | **Poate Reîncerca?** |
|---|---|---|---|
| Card Declined | `4000000000000002` | "Cardul a fost refuzat de bancă" | ✅ DA |
| Fonduri Insuficiente | `4000000000009995` | "Nu aveți fonduri suficiente" | ✅ DA |
| Card Expirat | `4000000000000069` | "Cardul folosit a expirat" | ✅ DA |
| CVC Incorect | `4000000000000127` | "Codul de securitate este incorect" | ✅ DA |
| Card Pierdut | `4000000000009987` | "Card raportat ca pierdut" | ❌ NU |
| Card Furat | `4000000000009979` | "Card raportat ca furat" | ❌ NU |
| Eroare Procesare | `4000000000000119` | "Eroare temporară de procesare" | ✅ DA |

---

## 🏆 **Beneficiile Sistemului de Erori**

### ✅ **Pentru Utilizatori:**
- Mesaje clare și înțelese
- Sugestii concrete pentru rezolvare
- Opțiuni simple de acțiune (reîncearcă/contact)
- Informații de contact accesibile

### ✅ **Pentru Dezvoltatori:**
- Debugging ușor cu parametri URL
- Loguri detaliate în consolă
- Testare automată cu scripturi
- Gestionare centralizată a erorilor

### ✅ **Pentru Business:**
- Reducerea abandonului de plăți
- Suport mai eficient pentru clienți  
- Tracking precis al tipurilor de erori
- Experiență utilizator profesională

---

## 🚀 **Comenzi Rapide pentru Testare**

```bash
# Pornește aplicația
npm run dev

# Test rapid toate erorile
node scripts/test-failed-payments.js

# Test o eroare specifică
node scripts/test-failed-payments.js card_declined

# Test webhook monitor
node scripts/webhook-monitor.js

# Accesează direct pagina de eroare
open http://localhost:3000/payment-error?code=insufficient_funds
```

---

## 📚 **Documentație Stripe**

- **Test Cards**: https://docs.stripe.com/testing#declined-payments
- **Error Codes**: https://docs.stripe.com/error-codes  
- **Decline Codes**: https://docs.stripe.com/declines/codes
- **Error Handling**: https://docs.stripe.com/error-handling

---

## 🎯 **Pentru Live Testing (Fără Plăți Reale)**

În mediul live, poți încă testa erorile fără să procesezi plăți reale:

1. **Folosește carduri de test în sandbox**
2. **Configurează webhook-uri de test**
3. **Simulează erori prin parametri URL**
4. **Testează cu Stripe CLI**:
   ```bash
   stripe trigger payment_intent.payment_failed
   ```

Acest sistem îți oferă control complet asupra testării erorilor de plată! 🎉 