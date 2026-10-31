# Prezență manuală LPR: reguli comune — 31.10.2026

## Principiul

Ocuparea curentă descrie prezența fizică. Schimbarea numărului și încadrarea în toleranța camerei nu sunt dovezi că mașina este sau nu este prezentă. Aceste condiții au fost eliminate din eligibilitatea reasocierii și recuperării manuale.

Camerele păstrează fereastra automată de ±2 ore. Intervenția manuală folosește rezervarea activă selectată, cu perioadă validă, confirmarea operatorului și dovezile șederii. Nu modifică perioada rezervării, tariful sau Multipark.

## Cazuri acoperite

| Situație | Operație | Efect fizic în Ocupare |
|---|---|---:|
| Intrare lipsă, inclusiv sosire anticipată | Intrare manuală confirmată | +1 |
| Mașină deja prezentă pe rezervarea selectată | Corectarea orei | 0 |
| O singură ședere prezentă fără rezervare, inclusiv înainte de perioada planificată | Asocierea aceleiași șederi | 0 |
| Ședere fără rezervare ștearsă prin confirmare greșită de absență | Recuperare și asociere | +1 |
| Același caz, cu numărul original sau modificat | Aceeași recuperare | +1 |
| Mașină încă prezentă după perioada rezervării | Recuperare confirmată a șederii șterse | +1 |
| Mașină plecată și reintrată fizic | Ședere nouă după confirmarea reintrării | +1 |
| Cerere repetată / salvări concurente | Rezultat inițial sau reverificare | 0 suplimentar |

O confirmare de prezență este necesară în formularul intrării noi. Confirmarea de reintrare existentă este reutilizată, fără a cere o a doua bifă. API-ul păstrează compatibilitatea cererilor existente; o intrare în afara ferestrei camerei necesită confirmarea explicită a prezenței sau reintrării.

## Cod și invarianta numărării

- `writeLprVisit` rămâne tranziția comună pentru trecerile fizice de intrare/ieșire ale camerelor și operatorilor.
- `linkLprVisit` centralizează scrierea rezervării, sursei, indexului LPR, marcajelor de contabilizare și contorului pentru asociere/recuperare. Cele două fluxuri nu mai au implementări separate ale acestor scrieri.
- Sursă prezentă: numărul prezențelor efective din snapshot se păstrează. Sursă arhivată absentă: se adaugă exact prezența recuperată. Tipul sursei este stabilit de server, nu de client.
- Verificarea dovezilor, a versiunilor, toate scrierile și auditul rămân în aceeași tranzacție. `requestId` protejează repetarea aceleiași operații.
- Sosirea istorică și momentul confirmării actuale de prezență rămân distincte. Evenimentele întârziate nu redeschid sau închid arbitrar o ședere rectificată.

Nu se ignoră o ieșire reală ulterioară, o altă ședere, o prezență multiplă, o rezervare inactivă, o perioadă invalidă, o oră viitoare/ambiguă sau un context modificat. Nu se reactivează automat rezervări plătite șterse și nu se inversează efecte financiare. Recuperarea descrisă aici privește șederile `unmatched_lpr` cu dovada exactă a confirmării manuale de absență.

## Verificare

Suita dedicată cuprinde 29 de scenarii: matricea celor trei roluri × număr original/modificat × sosire normală/anticipată, sosire cu peste șase ore mai devreme, ședere după perioada planificată, intrare fără citire de cameră, asociere fără loc suplimentar, reintrare reală în afara perioadei și toate protecțiile de concurență, repetare, rollback și dovezi contradictorii.

Browserul reproduce șapte fluxuri la 1440/390 px: număr modificat sau original, sosire anticipată, recuperare și intrare fizică nouă. Este verificată și reintrarea ulterioară pe aceeași rezervare anticipată, cu o singură bifă. API Ocupare, lista paginii și contorul sunt verificate separat.

Rezultate finale: **20/20 suite PASS**, **378 checkpoints**, inclusiv cele **29 de scenarii dedicate**; **7/7 fluxuri browser PASS**, plus verificarea reintrării ulterioare. Ocuparea este verificată după fiecare operație; secvența intrare → ștergere → recuperare → ieșire este `1 → 0 → 1 → 0`. TypeScript: 35 diagnostice la HEAD și 35 curente, zero diagnostice noi. `git diff --check`: PASS.

Dovezi locale: `/var/folders/57/w83hfs491_b5k_d4sw7tq1jh0000gq/T/parking-occupancy-acceptance-jGnlQD/report.md`, `/tmp/lpr-general-manual-browser-final.log`, `/tmp/lpr-general-manual-types-final.json`.

Comenzi din `next-js`:

```sh
npm run test:occupancy
FIREBASE_EMULATORS_PATH="$PWD/.firebase-emulators" LPR_RESTORE_FOCUSED=1 firebase emulators:exec --only firestore --project demo-parking-restoration-ui --config scripts/fixtures/lpr-emulator/firebase.json 'node scripts/test-manual-lpr-exit-browser.cjs'
```

Date exclusiv sintetice, emulatoare locale și autentificare criptografică simulată. Nu confirmă camerele fizice sau configurația/rularea de producție. Fără deploy și fără modificarea înregistrării reale GL07SPC.
