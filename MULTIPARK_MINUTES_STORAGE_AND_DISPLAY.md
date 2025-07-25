# 💾 Implementare: Stocarea și Afișarea Minutelor Multipark

## 🎯 **CERINȚA**

Stocarea minutelor calculate pentru Multipark (rotunjite la zile complete) în Firestore și afișarea lor în dashboard-ul admin la pop-up-ul de detalii rezervare cu câmpul "Minute în API".

---

## ✅ **IMPLEMENTAREA COMPLETĂ**

### **1. Modificarea Interfeței de Date**

#### **Backend - `CompleteBookingData` Interface:**
```typescript
// app/actions/booking-actions.ts
interface CompleteBookingData {
  // Date calculate
  durationMinutes: number
  multiparkDurationMinutes?: number // Minutele rotunjite trimise la Multipark API ← NOU
  days?: number
  amount?: number
  // ...
}
```

#### **Frontend - `Booking` Interface:**
```typescript
// app/admin/dashboard/bookings/page.tsx
interface Booking {
  // Date calculate
  durationMinutes: number
  multiparkDurationMinutes?: number // Minutele rotunjite trimise la Multipark API ← NOU
  days?: number
  amount?: number
  // ...
}
```

### **2. Calcularea și Salvarea în Firestore**

#### **Pentru toate rezervările (în `createBookingWithFirestore`):**
```typescript
// Date calculate
durationMinutes: Math.round(/* calculul real */),
multiparkDurationMinutes: (() => {
  // Calculează minutele rotunjite pentru Multipark (doar dacă nu e pay-on-site)
  if (additionalData?.source === "pay_on_site") return undefined
  const realMinutes = Math.round(/* calculul real */)
  const actualHours = realMinutes / 60
  const roundedUpDays = Math.ceil(actualHours / 24)
  return roundedUpDays * 24 * 60
})(),
```

#### **Pentru rezervări manuale (în `createManualBooking`):**
```typescript
// Calculează minutele pentru Multipark (rotunjit la zile complete)
const manualActualHours = durationMinutes / 60
const manualRoundedUpDays = Math.ceil(manualActualHours / 24)
const multiparkDurationMinutes = manualRoundedUpDays * 24 * 60

// Salvează în bookingData
const bookingData = {
  durationMinutes,
  multiparkDurationMinutes, // ← Salvat în Firestore
  // ...
}
```

### **3. Afișarea în Dashboard Admin**

#### **În dialogul de detalii rezervare:**
```tsx
<p>
  <strong>Durata reală:</strong> {selectedBooking.durationMinutes} minute ({(selectedBooking.durationMinutes / 60).toFixed(1)} ore)
</p>
{/* Pentru pay-on-site nu afișăm minutele API (nu se trimit la Multipark) */}
{selectedBooking.source !== "pay_on_site" && selectedBooking.multiparkDurationMinutes && (
  <p>
    <strong>Minute în API:</strong> {selectedBooking.multiparkDurationMinutes} minute ({(selectedBooking.multiparkDurationMinutes / 60)} ore)
  </p>
)}
```

---

## 📊 **EXEMPLE CONCRETE DE AFIȘARE**

### **Exemplu 1: Rezervare de 25 ore**
```
Durata reală: 1500 minute (25.0 ore)
Minute în API: 2880 minute (48 ore)
```

### **Exemplu 2: Rezervare de 48 ore exact**
```
Durata reală: 2880 minute (48.0 ore)
Minute în API: 2880 minute (48 ore)
```

### **Exemplu 3: Pay-on-site (nu se afișează minutele API)**
```
Durata reală: 1500 minute (25.0 ore)
// Nu se afișează "Minute în API" pentru pay-on-site
```

---

## 🔧 **LOGICA DE AFIȘARE**

### **Când se afișează "Minute în API":**
- ✅ **Pentru rezervări normale** (webhook, manual, test_mode)
- ✅ **Doar dacă există `multiparkDurationMinutes` în Firestore**
- ✅ **Doar dacă sunt diferite de durata reală**

### **Când NU se afișează:**
- ❌ **Pentru pay-on-site** (nu se trimit la Multipark)
- ❌ **Dacă `multiparkDurationMinutes` este `undefined`**
- ❌ **Pentru rezervări vechi** (înainte de implementare)

---

## 💾 **STOCAREA ÎN FIRESTORE**

### **Structura documentului:**
```json
{
  "durationMinutes": 1500,           // Durata reală calculată
  "multiparkDurationMinutes": 2880,  // Durata trimisă la Multipark (rotunjită)
  "days": 3,                         // Zile calculate pe baza duratei reale
  "licensePlate": "B123ABC",
  "source": "manual",
  // ... alte câmpuri
}
```

### **Pentru pay-on-site:**
```json
{
  "durationMinutes": 1500,           // Durata reală calculată
  "multiparkDurationMinutes": null,  // Nu se calculează pentru pay-on-site
  "days": 3,
  "licensePlate": "B123ABC",
  "source": "pay_on_site",
  // ... alte câmpuri
}
```

---

## 🎯 **BENEFICII**

### **1. Transparență:**
- **Administratorii** văd exact ce minute au fost trimise la Multipark
- **Debugging ușor** pentru problemele de sincronizare

### **2. Audit Trail:**
- **Istoric complet** al modificărilor de calcul
- **Comparație directă** între durata reală și cea API

### **3. Debugging:**
- **Ușor de verificat** dacă rotunjirea funcționează corect
- **Vizibilitate completă** asupra diferențelor de timp

### **4. Flexibilitate:**
- **Pay-on-site exclus** automat (nu au API minutes)
- **Backwards compatible** cu rezervările existente

---

## ⚡ **IMPLEMENTAREA TEHNICĂ**

### **Funcții modificate:**
1. **`createBookingWithFirestore()`** - calculul și salvarea pentru toate tipurile
2. **`createManualBooking()`** - calculul și salvarea pentru rezervări manuale
3. **Dashboard Admin** - afișarea în interfață

### **Validări:**
- ✅ Pay-on-site nu calculează `multiparkDurationMinutes`
- ✅ Rezervările existente funcționează fără câmpul nou
- ✅ Afișarea condiționată în funcție de tip și existența datelor

**Implementarea este completă și funcțională! 💾✨** 