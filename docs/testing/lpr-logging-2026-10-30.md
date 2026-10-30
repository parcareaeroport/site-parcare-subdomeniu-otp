# Diagnosticarea LPR în Vercel

Implementare locală, fără publicare sau modificări în Firebase producție. Autentificarea,
regulile orelor, răspunsurile HTTP și calculul ocupării sunt păstrate.

## Cum urmărim un incident

În proiectul Vercel, deschide **Logs**, selectează Production și perioada incidentului:

1. Caută `LPR` sau numărul normalizat, de exemplu `B804CTN`.
2. Copiază `requestId` din mesaj pentru întreaga cerere; `eventId` leagă aceeași
   înregistrare de reîncercări. `bookingId` și `visitId` identifică rezervarea/șederea.
3. `received` confirmă că handlerul a început. `camera_validated` arată orele brute,
   ora interpretată, diferența față de server, direcția și configurația folosită.
4. `decision` explică rezultatul: `matched`, `unmatched_visit`, `duplicate`,
   `whitelist_skip`, `needs_review`, `pending`. `reason` și `explanation` arată de ce.
5. Numai `visit_committed` confirmă o tranziție salvată. Verifică `insideBefore`,
   `insideAfter` și `occupancyDelta`. `arrival_corrected` păstrează prezența și are delta 0.
6. `response` indică statusul HTTP și durata. **200 nu înseamnă automat că ocuparea s-a schimbat.**

Exemplu: `camera_validated` cu `reason: future_event_time` înseamnă că ora camerei
este în viitor. `decision: needs_review` explică de ce ocuparea nu a fost modificată,
chiar dacă răspunsul HTTP este 200. Ora primită nu este corectată de logger.

## Alte fluxuri

- `KeepAlive`: o singură linie `alive`; dovedește conectivitate, nu recunoașterea unei mașini.
- Admin: `action: prepare`/`save`, UID verificat pe server, confirmările operatorului,
  `manual_prepared`, `manual_saved`, `manual_rejected`, `manual_replay`.
  O cerere repetată poate returna rezultatul original; `manual_replay` are delta 0.
- Verificare ADMIN: `admin_review` cu acțiunea, numărul și ID-ul evenimentului; nu logăm nota liberă.
- Cron: `retry_result` pentru fiecare eveniment și `retry_summary`. Un 503 cu
  `worker_not_configured` identifică lipsa configurării workerului; nu modificăm acea configurație.
- ANPR/Hikvision și Metrici: `receipt_only` arată că rutele existente recepționează/
  răspund, fără a pretinde că actualizează ocuparea. Comanda de barieră Metrici este
  un boolean, nu tokenul protocolului. Rutele `oprit` nu sunt redenumite/activate.

Logurile sunt JSON pe o singură linie, fără chei, tokenuri, cookie-uri, fotografii,
payloaduri integrale, emailuri sau telefoane. Numărul și identificatorii operaționali
rămân căutabili. Câmpurile sunt limitate la 240 caractere; listele de candidați la 20 ID-uri.
Erorile tehnice includ clasa și codul, fără mesaj/stack arbitrar care ar putea conține date.

Loggerul nu face citiri Firestore suplimentare. Mesajele din tranzacții sunt păstrate
separat pentru fiecare încercare și emise numai după commit; încercările abandonate nu
produc mesaje false de succes. Contextul fiecărei cereri și al fiecărui element cron este izolat.

## Verificări

- `node scripts/test-lpr-logging.cjs`: corelare, concurență, redacție inclusiv debug Metrici,
  limite, logger defect, tranzacție reluată/abandonată, KeepAlive, refuzuri cron, ANPR.
- `node scripts/test-lpr-camera-compatibility.cjs`: 11 scenarii de compatibilitate.
- **211 scenarii trecute în cele 8 suite emulator**: asociere, protecții intrare/ieșire, ordonare/corectări,
  intrări/ieșiri manuale, integritate, ocupare unificată. Date sintetice în proiecte `demo-*`.
- `node scripts/test-lpr-log-evidence.cjs /tmp/lpr-logging-test-*-emulator.log` verifică
  acoperirea diagnosticelor, câmpurile interzise și coerența deltelor; **1.291 intrări de log verificate**.
- TypeScript: 34 diagnostice existente în testele fără tipuri de runner și integrarea Stripe;
  niciun diagnostic în fișierele modificate pentru loguri.

Testul vechi care cerea 401/403 camerelor a fost actualizat la comportamentul aprobat
anterior: camere fără cheie acceptate, evenimente repetate fără dublarea ocupării,
direcție necunoscută trimisă la verificare.

După publicare trebuie urmărite o intrare și o ieșire reale: request → decision → commit →
prezență/contor. Cererile blocate înainte de handler se investighează în Request Logs;
absența mesajelor din aplicație singură nu dovedește că nu există trafic.
