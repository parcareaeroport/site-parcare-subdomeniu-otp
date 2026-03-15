# OBLIO Incident Runbook

## Scop
Acest runbook descrie pașii operaționali pentru incidentele de facturare Oblio:
- `Oblio timeout`
- `Oblio authentication failed: 503`
- alte erori de facturare (`invoice_error`, `auth_other`)

Sistemul este proiectat să continue rezervarea normal chiar dacă facturarea Oblio eșuează.

## Semnale de incident
- Logs aplicație (Vercel):
  - `❌ Eroare critică la generarea facturii Oblio: Error: Oblio timeout`
  - `❌ Oblio auth failed - Response body: ... 503 Service Unavailable`
  - `❌ Eroare la generarea facturii Oblio: ...`
- Firestore:
  - colecția `oblio_alert_events` (evenimente individuale)
  - documentul `ops_alerts/oblio` (alertă agregată)

## Unde verifici rapid
1. Vercel logs pentru endpointurile:
   - `/api/wp-card-booking`
   - `/api/webhook`
2. Firestore:
   - `oblio_alert_events` (filtrare după `eventAt` desc)
   - `ops_alerts/oblio`:
     - `status` (`open` / `resolved`)
     - `lastEventAt`
     - `lastCountInWindow`
     - `lastErrorKind`
     - `lastErrorSample`
3. Admin dashboard -> Bookings -> dialog booking -> secțiunea `Factură Oblio`.

## Triage: provider vs aplicație
1. Dacă vezi `503 Service Unavailable` la auth:
   - cauză probabilă: indisponibilitate Oblio.
2. Dacă vezi `Oblio timeout`:
   - poate fi latență provider sau rețea outbound.
3. Dacă vezi `auth_other` (fără 503):
   - verifică variabilele `OBLIO_EMAIL`, `OBLIO_SECRET`, `OBLIO_CIF`, `OBLIO_SERIES`.
4. Confirmă că rezervările se creează în continuare (comportament expected).

## Prag alertare și auto-close
- Alertă `open` când sunt minim `3` erori în `5` minute.
- Auto-close la `30` minute fără erori noi.
- Auto-close se execută la rularea endpointului cron existent: `/api/cron/process-queue`.

## Re-facturare manuală (UI Admin)
1. Intră în `Admin -> Bookings`.
2. Deschide rezervarea eligibilă (`paid online`, `source=webhook|test_mode`, neanulată).
3. Click pe `Regenerează factură Oblio`.
4. Verifică:
   - toast de succes/eșec
   - secțiunea `Factură Oblio` din dialog
   - câmpurile `bookings/{id}.oblio.*` în Firestore.

## Criterii de escalare
Escaladează către provider/infrastructură dacă:
1. `auth_503` persistă > 30 minute.
2. rata de eșec rămâne ridicată după retry manual.
3. apar timeout-uri simultan pe mai multe fluxuri de booking.

## Fallback manual pentru cron (dacă nu rulează Vercel Cron)
Rulează periodic endpointul cron pentru procesare + auto-resolve alert:

```bash
curl -X GET "https://rezervari.otp-parking.ro/api/cron/process-queue" \
  -H "Authorization: Bearer ${CRON_SECRET}"
```

Opțional cu cleanup:

```bash
curl -X GET "https://rezervari.otp-parking.ro/api/cron/process-queue?cleanup=true" \
  -H "Authorization: Bearer ${CRON_SECRET}"
```

## Verificare post-incident
1. `ops_alerts/oblio.status` devine `resolved`.
2. Nu mai apar evenimente noi în `oblio_alert_events` pentru fereastra curentă.
3. Rezervările afectate au fost re-facturate manual (unde este cazul).
