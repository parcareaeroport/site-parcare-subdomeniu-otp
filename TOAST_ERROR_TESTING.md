# 🍞 Ghid Testare Toast-uri pentru Erori de Plată

## 🎯 **Toast-uri în loc de pagini separate**

Am simplificat experiența utilizatorului - în loc să fie redirectat pe o pagină de eroare, utilizatorul vede un toast detaliat direct în formularul de checkout și poate încerca imediat din nou.

---

## 📱 **Tipuri de Toast-uri pentru Erori**

### **1. Erori de Card**
```javascript
// Card respins generic
Card: 4000000000000002
Toast: "Card respins" 
Msg: "Cardul a fost respins de bancă. Verificați datele sau folosiți alt card."

// Fonduri insuficiente  
Card: 4000000000009995
Toast: "Card respins"
Msg: "Fonduri insuficiente pe card. Verificați soldul sau folosiți alt card."

// Card expirat
Card: 4000000000000069
Toast: "Card expirat"
Msg: "Cardul a expirat. Verificați data de expirare sau folosiți alt card."
```

### **2. Erori de Date**
```javascript
// CVC incorect
Card: 4000000000000127
Toast: "CVC incorect"
Msg: "Codul de securitate (CVC) este incorect. Verificați codul de pe spatele cardului."

// Număr invalid
Card: 4242424242424241  
Toast: "Număr card invalid"
Msg: "Numărul cardului nu este valid. Verificați numerele introduse."
```

### **3. Erori Grave (Toast mai lung - 10s)**
```javascript
// Card pierdut
Card: 4000000000009987
Toast: "Card respins" 
Msg: "Cardul a fost raportat ca pierdut. Contactați banca sau folosiți alt card."
Duration: 10 secunde

// Card furat
Card: 4000000000009979
Toast: "Card respins"
Msg: "Cardul a fost raportat ca furat. Contactați banca sau folosiți alt card."
Duration: 10 secunde
```

### **4. Erori de Procesare**
```javascript
// Eroare temporară
Card: 4000000000000119
Toast: "Eroare de procesare"
Msg: "Eroare temporară la procesare. Încercați din nou în câteva minute."
```

---

## 🧪 **Cum să Testezi Toast-urile**

### **Pas 1: Mergi la Checkout**
```
http://localhost:3000/plasare-comanda
```

### **Pas 2: Completează Formularul**
- Nume: Test
- Email: test@example.com  
- Telefon: 0700000000
- Etc.

### **Pas 3: Folosește Carduri de Test**
În formularul de plată Stripe:
```
Număr: 4000000000000002 (pentru generic decline)
Data: 12/34 (orice dată viitoare)
CVC: 123 (orice 3 cifre)
Nume: Test User
```

### **Pas 4: Apasă "Plătește acum"**
Vei vedea toast-ul cu eroarea specifică în partea de sus a ecranului.

### **Pas 5: Încearcă din nou**
Formularul rămâne activ, poți încerca imediat cu alt card.

---

## 🎬 **Fluxul Actualizat**

```
User completează formular →
User introduce card de test →
User apasă "Plătește acum" →
Stripe returnează eroare →
Toast apare cu mesaj specific →
User poate încerca imediat din nou
```

**Ce NU se mai întâmplă:**
- ❌ Nu mai există redirecționare către pagină separată
- ❌ Nu se pierd datele din formular
- ❌ Nu trebuie să reintroducă informațiile

---

## 🚀 **Testare Rapidă cu Script**

```bash
# Pornește aplicația
npm run dev

# Script pentru testare automată (creează PaymentIntents de test)
node scripts/test-failed-payments.js

# Test un singur tip de eroare
node scripts/test-failed-payments.js insufficient_funds
```

**Nota**: Scriptul creează PaymentIntent-uri de test dar toast-urile se văd doar în browser când confirmi plata.

---

## 📋 **Lista Completă de Teste Manuale**

| **Card de Test** | **Tip Eroare** | **Toast Title** | **Durată** |
|---|---|---|---|
| `4000000000000002` | Generic decline | "Card respins" | 5s |
| `4000000000009995` | Fonduri insuficiente | "Card respins" | 5s |
| `4000000000000069` | Card expirat | "Card expirat" | 5s |
| `4000000000000127` | CVC incorect | "CVC incorect" | 5s |
| `4242424242424241` | Număr invalid | "Număr card invalid" | 5s |
| `4000000000000119` | Eroare procesare | "Eroare de procesare" | 5s |
| `4000000000009987` | Card pierdut | "Card respins" | **10s** |
| `4000000000009979` | Card furat | "Card respins" | **10s** |

---

## 🎯 **Beneficii Toast vs Pagină Separată**

### ✅ **Pentru Utilizatori:**
- **Rămân în context** - nu pierd formularul completat
- **Feedback imediat** - văd eroarea exact unde a apărut  
- **Reîncercare rapidă** - pot schimba imediat cardul
- **Experiență fluidă** - nu sunt rupți din flux

### ✅ **Pentru Dezvoltatori:**
- **Cod mai simplu** - nu mai e nevoie de pagină separată
- **Debugging mai ușor** - toate erorile în consolă
- **UX mai bun** - utilizatorii nu abandonează formularul

### ✅ **Pentru Business:**
- **Rate de conversie mai mari** - mai puține abandonări
- **Suport mai puțin** - mesajele sunt clare și acționabile
- **Experiență profesională** - comportament natural pentru e-commerce

---

## 🔧 **Pentru Debugging**

Toast-urile afișează și detalii în consolă:
```javascript
console.log('Payment Error Details:', {
  code: error.code,           // Ex: 'card_declined'
  message: error.message,     // Mesajul original de la Stripe
  decline_code: error.decline_code, // Ex: 'insufficient_funds'
  type: error.type           // Ex: 'card_error'
})
```

Acum ai o experiență mult mai naturală pentru gestionarea erorilor de plată! 🎉 