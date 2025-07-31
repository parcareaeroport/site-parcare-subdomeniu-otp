# 🚗 Metrici LPR Test API - Console Logs Only

API simplu pentru testarea și logging-ul datelor primite de la sistemul Metrici LPR **doar în console** (perfect pentru Vercel).

## 📁 Fișiere Create

```
app/api/metrici-lpr-test/route.ts    # API endpoint principal
scripts/test-metrici-lpr.js          # Script de testare
scripts/test-minimal-lpr.js          # Script test robustețe cu date parțiale
METRICI_LPR_TEST_README.md           # Acest fișier
METRICI_LPR_ENV_VARS.md              # Documentație variabile mediu
METRICI_LPR_ROBUSTNESS.md            # Documentație robustețe date parțiale
```

## ✅ **Funcționează FĂRĂ variabile de mediu și cu date parțiale!**

API-ul funcționează perfect **fără nicio configurație** și acceptă **orice combinație de date** de la Metrici, de la hardware complet la configurații minimaliste.

🔍 **Vezi documentația completă despre robustețe:** [`METRICI_LPR_ROBUSTNESS.md`](./METRICI_LPR_ROBUSTNESS.md)

## 🚀 Cum să testezi

### 1. Pornește serverul Next.js

```bash
npm run dev
# sau
yarn dev
```

Serverul va rula pe `http://localhost:3000`

### 2. Testează cu script-ul

```bash
# Instalează dependențele pentru testare
npm install form-data node-fetch

# Test normal (cu date complete)
npm run test-lpr

# Test cu debug mode
LPR_DEBUG_MODE=true npm run test-lpr

# Test ROBUSTEȚE cu date parțiale/minime
npm run test-lpr-minimal

# Test cu autentificare
LPR_AUTH_SECRET=test123 npm run test-lpr
```

### 3. Testează manual cu cURL

```bash
# Test de bază (date minime)
curl -X POST http://localhost:3000/api/metrici-lpr-test \
  -F "number=B123ABC" \
  -F "direction=1"

# Test cu doar numărul (fără direcție)
curl -X POST http://localhost:3000/api/metrici-lpr-test \
  -F "number=B456DEF"

# Test cu autentificare
curl -X POST http://localhost:3000/api/metrici-lpr-test \
  -H "Authorization: Bearer your_secret" \
  -F "number=B123ABC" \
  -F "direction=1"
```

## 🔧 **Variabile de Mediu Opționale**

### Control de bază:
```bash
LPR_ENABLED=true              # Activează/dezactivează LPR (default: true)
LPR_DEBUG_MODE=false          # Debug verbose logs (default: false)
LPR_AUTH_SECRET=your_secret   # Secret pentru autentificare (optional)
```

### Comportament:
```bash
LPR_DEFAULT_ACTION=allow      # allow, deny, manual (default: allow)
LPR_AUTO_OPEN_BARRIER=true    # Deschide automat bariera (default: true)
```

### Setare în Vercel:
```bash
vercel env add LPR_ENABLED
vercel env add LPR_DEBUG_MODE
vercel env add LPR_AUTH_SECRET
```

## 📊 Ce face API-ul

### ✅ Primește toate datele de la Metrici:

- **Text fields**: număr, țară, direcție, probabilitate, etc.
- **Images**: informații despre pozele primite (nume, mărime, tip)
- **Metadata**: timestamp, GPS, greutate, viteză, etc.
- **🛡️ ROBUST**: Funcționează chiar dacă Metrici trimite doar câteva câmpuri

### 📝 Loghează totul în CONSOLE:

- **Console**: Afișează în timp real toate datele primite cu emojis
- **Vercel Logs**: Visible în Vercel dashboard → Functions → Logs
- **Debug Mode**: Logs extra pentru debugging
- **Data Validation**: Verifică și raportează ce date sunt disponibile

### 🤖 Răspunde corect către Metrici:

- **Check action + auto-open**: `fbd782b5b1f90875a9773ef20bcc16aa open_barrier`
- **Check action no auto-open**: `fbd782b5b1f90875a9773ef20bcc16aa`
- **Reporting**: `bb1e8f805814a0b8e46560134687237`

### 🔐 Features de securitate:

- **Authentication**: Verifică `Authorization: Bearer secret`
- **Disable switch**: Poate fi dezactivat instant cu `LPR_ENABLED=false`
- **Configurable responses**: Control complet asupra răspunsurilor

## 🔍 Exemplu console output

### Normal mode:
```
🚗 [LPR_1642234567890_abc123] ===== METRICI LPR REQUEST RECEIVED =====
📝 [LPR_1642234567890_abc123] number: B123ABC
📝 [LPR_1642234567890_abc123] direction: 1
📊 [LPR_1642234567890_abc123] Received 2 text fields and 0 images
🔍 [LPR_1642234567890_abc123] ===== DATA VALIDATION =====
🔍 [LPR_1642234567890_abc123] Has License Plate: ✅ (B123ABC)
🔍 [LPR_1642234567890_abc123] Has Direction: ✅ (1)
🚪 [LPR_1642234567890_abc123] RESPONSE: Allowing access and opening barrier
✅ [LPR_1642234567890_abc123] Processing completed in 15ms
```

### Cu date parțiale:
```
🚗 [LPR_1642234567890_def456] ===== METRICI LPR REQUEST RECEIVED =====
📝 [LPR_1642234567890_def456] number: B456DEF
📊 [LPR_1642234567890_def456] Received 1 text fields and 0 images
🔍 [LPR_1642234567890_def456] ===== DATA VALIDATION =====
🔍 [LPR_1642234567890_def456] Has License Plate: ✅ (B456DEF)
🔍 [LPR_1642234567890_def456] Has Direction: ❌ (MISSING)
📊 [LPR_1642234567890_def456] RESPONSE: License plate detected but no direction - standard acknowledgment
✅ [LPR_1642234567890_def456] Processing completed in 12ms
```

### Debug mode (`LPR_DEBUG_MODE=true`):
```
🚗 [LPR_1642234567890_abc123] ===== METRICI LPR REQUEST RECEIVED =====
🐛 [LPR_1642234567890_abc123] Debug mode enabled
🐛 [LPR_1642234567890_abc123] Headers: {"content-type": "multipart/form-data", ...}
📝 [LPR_1642234567890_abc123] number: B123ABC
🖼️ [LPR_1642234567890_abc123] Image: plate_image - plate.jpg (15678 bytes)
📊 [LPR_1642234567890_abc123] Complete LPR Text Data: {...}
🔍 [LPR_1642234567890_abc123] ===== PARSED METRICI DATA =====
🚪 [LPR_1642234567890_abc123] RESPONSE: Allowing access and opening barrier
✅ [LPR_1642234567890_abc123] Processing completed in 25ms
```

### Cu autentificare:
```
🚗 [LPR_1642234567890_abc123] ===== METRICI LPR REQUEST RECEIVED =====
🔐 [LPR_1642234567890_abc123] Authentication successful
📝 [LPR_1642234567890_abc123] number: B123ABC
...
```

## 🌐 Configurare Metrici LPR

În interfața Metrici, setează:

### Pentru testare:
- **Reporting URL**: `http://localhost:3000/api/metrici-lpr-test`
- **Check action URL**: `http://localhost:3000/api/metrici-lpr-test`

### Pentru producție:
- **Reporting URL**: `https://your-vercel-domain.com/api/metrici-lpr-test`
- **Check action URL**: `https://your-vercel-domain.com/api/metrici-lpr-test`

### Cu autentificare (dacă folosești `LPR_AUTH_SECRET`):
- **Headers**: `Authorization: Bearer your_secret_key`

### Setări comune:
- **Method**: POST
- **Content-Type**: multipart/form-data
- **Timeout**: 5-10 secunde

## 🌐 Vercel Deployment

### Pentru testare pe Vercel:

1. **Deploy**: `vercel --prod`
2. **Environment Variables**: Setează în Vercel Dashboard
3. **Logs**: Vezi în Vercel Dashboard → Functions → View Function Logs

### Accesul la logs în Vercel:

```bash
# CLI pentru logs live
vercel logs [deployment-url]

# Sau în browser
https://vercel.com/your-team/your-project/functions
```

## 🧪 Scenarii de testare

### Test simplu (fără env vars):
```bash
npm run test-lpr
```

### Test robustețe (date parțiale):
```bash
npm run test-lpr-minimal
```

### Test cu debug:
```bash
LPR_DEBUG_MODE=true npm run test-lpr
```

### Test cu autentificare:
```bash
LPR_AUTH_SECRET=mysecret123 npm run test-lpr
```

### Test cu LPR dezactivat:
```bash
LPR_ENABLED=false npm run test-lpr
# Va returna "LPR disabled"
```

### Test cu bariera fără auto-open:
```bash
LPR_AUTO_OPEN_BARRIER=false npm run test-lpr
# Va returna check response fără "open_barrier"
```

## 🚨 Testare rapidă

Testare minimă cu doar numărul:

```bash
curl -X POST https://your-vercel-domain.com/api/metrici-lpr-test \
  -F "number=B999TEST"
```

## 🔧 Pentru producție

- **Authentication**: Setează `LPR_AUTH_SECRET` și configurează în Metrici
- **Debug**: Dezactivează `LPR_DEBUG_MODE` în producție
- **Monitoring**: Configurează alerting pentru erori
- **Validation**: Toate input-urile sunt validate automat

## 📞 Debugging

Dacă întâmpini probleme:

1. **Local**: Verifică console în terminal
2. **Vercel**: Verifică Function Logs în dashboard
3. **Test**: Folosește cURL pentru test rapid
4. **Debug**: Activează `LPR_DEBUG_MODE=true`
5. **Auth**: Verifică că Metrici trimite header-ul corect
6. **Robustețe**: Testează cu `npm run test-lpr-minimal`

## 📋 Status Codes

- **200**: Success (cu răspuns Metrici valid)
- **401**: Unauthorized (auth header invalid)
- **503**: Service Unavailable (LPR disabled)

## 🛡️ Garanții de Robustețe

- ✅ **Funcționează cu ORICE date**: De la hardware complet la configurații minimaliste
- ✅ **Niciodată nu se strică**: Întotdeauna returnează răspuns valid
- ✅ **Graceful degradation**: Funcționalitate redusă cu date parțiale
- ✅ **Fail-safe**: Acknowledgment în toate scenariile

**API-ul este optimizat pentru Vercel, configurabil prin env vars, robust cu date parțiale și loghează totul în console!** 🎉 