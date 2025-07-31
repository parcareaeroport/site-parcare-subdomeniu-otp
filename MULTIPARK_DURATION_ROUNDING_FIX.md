# ⏱️ Modificare: Calculul Duratei pentru Multipark (Rotunjire la Zile Complete)

## 🎯 **CERINȚA**

Modificarea calculului duratei în minute trimise către **API-ul Multipark**, pentru a rotunki în sus la următorul multiplu de 24 ore (zile complete), dar **DOAR pentru Multipark**, nu pentru alte părți ale sistemului.

### 📋 **Logica cerută:**
- **20 ore** → calculează pentru **24 ore** (1440 minute)
- **26 ore** → calculează pentru **48 ore** (2880 minute) 
- **50 ore** → calculează pentru **72 ore** (4320 minute)
- **Dacă trece și cu 1 minut peste 24, 48, 72 ore** → calculează pentru următoarele 24 ore

---

## ✅ **IMPLEMENTAREA**

### **1. În `createBooking()` - Linia 456-465**

#### **ÎNAINTE:**
```typescript
// Calculate duration in minutes
const durationMinutes = Math.round((endDateTime.getTime() - startDateTime.getTime()) / (1000 * 60))

// XML Payload
<Duration>${durationMinutes}</Duration>
```

#### **DUPĂ:**
```typescript
// Calculate duration in minutes (real duration)
const durationMinutes = Math.round((endDateTime.getTime() - startDateTime.getTime()) / (1000 * 60))

// Calculate duration for Multipark API (rounded up to full days)
const actualHours = durationMinutes / 60
const roundedUpDays = Math.ceil(actualHours / 24)
const multiparkDurationMinutes = roundedUpDays * 24 * 60

// XML Payload
<Duration>${multiparkDurationMinutes}</Duration>
```

### **2. În `createManualBooking()` - Linia 1190-1199**

#### **ÎNAINTE:**
```typescript
// Calculează durata în minute pentru API
const apiDurationMinutes = Math.round((apiEndDateTime.getTime() - apiStartDateTime.getTime()) / (1000 * 60))

// XML Payload
<Duration>${apiDurationMinutes}</Duration>
```

#### **DUPĂ:**
```typescript
// Calculează durata în minute pentru API (rotunjit în sus la zile complete)
const realApiDurationMinutes = Math.round((apiEndDateTime.getTime() - apiStartDateTime.getTime()) / (1000 * 60))

// Rotunjire în sus la zile complete pentru Multipark
const actualHours = realApiDurationMinutes / 60
const roundedUpDays = Math.ceil(actualHours / 24)
const apiDurationMinutes = roundedUpDays * 24 * 60

// XML Payload
<Duration>${apiDurationMinutes}</Duration>
```

---

## 📊 **EXEMPLE CONCRETE**

### **Exemplu 1: Rezervare de 25 ore**
- **Input**: 15 ian 10:00 → 16 ian 11:00
- **Durata reală**: 25 ore = 1500 minute
- **Multipark primește**: Math.ceil(25/24) = 2 zile = 2880 minute
- **Diferența**: +23 ore (1380 minute) în plus

### **Exemplu 2: Rezervare de 48.1 ore**
- **Input**: 15 ian 10:00 → 17 ian 10:06
- **Durata reală**: 48.1 ore = 2886 minute
- **Multipark primește**: Math.ceil(48.1/24) = 3 zile = 4320 minute
- **Diferența**: +23.9 ore (1434 minute) în plus

### **Exemplu 3: Rezervare exact 48 ore**
- **Input**: 15 ian 10:00 → 17 ian 10:00
- **Durata reală**: 48 ore = 2880 minute
- **Multipark primește**: Math.ceil(48/24) = 2 zile = 2880 minute
- **Diferența**: 0 (niciun surplus)

---

## 🔧 **LOGGING ADĂUGAT**

### **Pentru rezervări normale:**
```
⏱️ Duration calculation for Multipark:
   📏 Real duration: 1500 minutes (25.0 hours)
   📅 Rounded up to: 2 days
   🎯 Multipark duration: 2880 minutes (48 hours)
```

### **Pentru rezervări manuale:**
```
⏱️ [MANUAL_1752504567890] Duration calculation for Multipark:
⏱️ [MANUAL_1752504567890]   📏 Real duration: 1500 minutes (25.0 hours)
⏱️ [MANUAL_1752504567890]   📅 Rounded up to: 2 days
⏱️ [MANUAL_1752504567890]   🎯 Multipark duration: 2880 minutes (48 hours)
```

---

## 📍 **CE NU S-A MODIFICAT**

### **1. Frontend (UI/UX):**
- ✅ **Calculul prețurilor** rămâne pe zile reale
- ✅ **Afișarea duratei** rămâne corectă pentru utilizatori
- ✅ **Validările** rămân pe durata reală

### **2. Backend (Firestore):**
- ✅ **Salvarea în Firestore** folosește durata reală (`durationMinutes`)
- ✅ **Statisticile** folosesc durata reală
- ✅ **Rapoartele** sunt bazate pe durata reală

### **3. API Test:**
- ✅ **Test API** permet încă introducerea manuală exactă a minutelor
- ✅ **Testarea** cu valori precise rămâne posibilă

---

## ⚡ **IMPACT**

### **Pozitiv:**
1. **Consistență cu plata**: Dacă plata se face pe zile complete, Multipark primește durata pe zile complete
2. **Evită problemele de acces**: Nu risc ca rezervarea să expire înainte de terminarea zilei plătite
3. **Siguranță**: Clienții au acces garantat pentru întreaga perioadă plătită

### **De monitorizat:**
1. **Utilizarea spoturilor**: Multipark va rezerva mai mult timp decât necesar
2. **Statistici**: Trebuie să folosim durata reală din Firestore, nu cea din Multipark

---

## 🎯 **FORMULA FINALĂ**

```typescript
// Pentru Multipark DOAR
const actualHours = realDurationMinutes / 60
const roundedUpDays = Math.ceil(actualHours / 24)
const multiparkDurationMinutes = roundedUpDays * 24 * 60
```

**Rezultatul**: Multipark primește întotdeauna minute pentru zile complete, indiferent de durata exactă a rezervării.

**Modificarea este aplicată DOAR în funcțiile care comunică direct cu API-ul Multipark!** 