# 🔧 Variabile de Mediu pentru Metrici LPR

## ✅ **STATUS: NU sunt OBLIGATORII**

API-ul simplu funcționează **fără nicio variabilă de mediu** specifică pentru LPR.

## 📋 **Variabile Existente (folosite)**

### Pentru testare:
```bash
NEXT_PUBLIC_APP_URL=https://your-domain.com  # Opțional, default: http://localhost:3000
```

## 🚀 **Variabile Recomandate pentru Producție**

### 1. Control de bază
```bash
# Activare/dezactivare LPR
LPR_ENABLED=true

# Debug mode pentru logs extra
LPR_DEBUG_MODE=false

# Secret pentru autentificare Metrici (opțional)
LPR_AUTH_SECRET=your_secret_key_here
```

### 2. Comportament răspunsuri
```bash
# Acțiunea default: allow, deny, manual
LPR_DEFAULT_ACTION=allow

# Deschide automat bariera pentru intrări valide
LPR_AUTO_OPEN_BARRIER=true

# Permite accesul și pentru mașini necunoscute
LPR_ALLOW_UNKNOWN_VEHICLES=false
```

### 3. Securitate (pentru producție)
```bash
# Rate limiting
LPR_RATE_LIMIT_ENABLED=true
LPR_RATE_LIMIT_MAX_REQUESTS=100

# IP whitelist pentru Metrici server
LPR_ALLOWED_IPS="192.168.1.100,10.0.0.50"
```

### 4. Monitoring
```bash
# Nivel de logging: debug, info, warn, error
LPR_LOG_LEVEL=info

# Webhook pentru alerting
LPR_ALERT_WEBHOOK_URL=https://your-monitoring-system.com/webhook
```

## 🛠️ **Implementare în API**

Pentru a folosi aceste variabile, actualizează `route.ts`:

```typescript
// app/api/metrici-lpr-test/route.ts

export async function POST(request: NextRequest) {
  // Verifică dacă LPR este activat
  if (process.env.LPR_ENABLED === 'false') {
    console.log('🚫 LPR is disabled via environment variable')
    return new Response("LPR disabled", { status: 503 })
  }

  // Debug mode
  const debugMode = process.env.LPR_DEBUG_MODE === 'true'
  if (debugMode) {
    console.log('🐛 LPR Debug mode enabled')
  }

  // ... rest of code ...

  // Verifică autentificare (opțional)
  if (process.env.LPR_AUTH_SECRET) {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.LPR_AUTH_SECRET}`) {
      console.log('🔒 Invalid LPR authentication')
      return new Response("Unauthorized", { status: 401 })
    }
  }

  // Configurează răspunsul
  const autoOpenBarrier = process.env.LPR_AUTO_OPEN_BARRIER !== 'false'
  const defaultAction = process.env.LPR_DEFAULT_ACTION || 'allow'
  
  // ... logică răspuns ...
}
```

## 🌐 **Setare în Vercel**

### Via Vercel Dashboard:
1. Du-te la Project Settings
2. Environment Variables
3. Adaugă variabilele necesare

### Via Vercel CLI:
```bash
vercel env add LPR_ENABLED
vercel env add LPR_DEBUG_MODE
vercel env add LPR_AUTH_SECRET
```

## 📝 **Exemplu .env.local pentru dezvoltare**

```bash
# Copiază în .env.local pentru testare locală
LPR_ENABLED=true
LPR_DEBUG_MODE=true
LPR_AUTH_SECRET=test_secret_123
LPR_DEFAULT_ACTION=allow
LPR_AUTO_OPEN_BARRIER=true
LPR_LOG_LEVEL=debug
```

## ⚠️ **Important pentru Security**

### Nu expune în frontend:
- **NU** folosește `NEXT_PUBLIC_` pentru secretele LPR
- Toate variabilele LPR sunt server-only
- `LPR_AUTH_SECRET` trebuie să fie securizat

### Pentru Metrici config:
- Dacă folosești `LPR_AUTH_SECRET`, configurează în Metrici:
  - Header: `Authorization: Bearer your_secret_key_here`

## 🧪 **Pentru testare simplă**

**Nu trebuie să setezi nimic!** API-ul funcționează cu valorile default:

```bash
# Testare fără variabile de mediu
npm run dev
npm run test-lpr
```

## 📞 **Summary**

- **Pentru testare**: NU trebuie nimic
- **Pentru producție**: Recomand măcar `LPR_ENABLED` și `LPR_AUTH_SECRET`
- **Pentru debugging**: Adaugă `LPR_DEBUG_MODE=true`
- **Pentru securitate**: Activează rate limiting și IP whitelist 