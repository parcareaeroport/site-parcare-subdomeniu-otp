# Teste pentru toate căile de intrare în Ocupare (+1)

Rulare unică: `npm run test:occupancy:entries`.

Comanda pornește un emulator Firestore izolat, cu proiecte `demo-*`, rulează suitele și scrie un raport Markdown, `results.json`, `entries-matrix.json`, logurile și amprentele surselor. Conexiunile din procesele de test sunt limitate la loopback; nu încarcă cheile aplicației, nu folosește datele de producție și nu contactează camerele, Multipark, plățile sau serviciile de email. Transportul comercial și verificarea criptografică a tokenurilor sunt simulate. Verificările de rol, procesarea LPR, endpointurile și tranzacțiile Firestore sunt reale.

Matricea nouă rulează endpointurile printr-un server HTTP local. Pentru acțiunile server `createManualBooking` și `saveCompleteBookingToFirestore`, execută corpurile integrale extrase din fișierul real, cu dependențele Firestore reale din emulator și transportul comercial simulat. Nu verifică întregul checkout de plată și nici înregistrarea efectivă a unei plăți.

## Ce se numără

Pagina folosește lista de documente `bookings` cu prezență LPR efectivă, returnată de `GET /api/admin/occupancy`. Nu afișează direct `config/parkingLive.occupiedCount`.

La fiecare pas, matricea verifică:

- variația exactă a numărului din API: `+1`, `0`, `−1`, respectiv `+2` pentru două mașini distincte;
- identitatea documentelor și numerele returnate în listă, fără dublarea unui număr normalizat;
- aceeași numărătoare în calculul comun al contoarelor client;
- referința `lpr_plate_state`, `bookingId`, `visitId` și prezența pentru fiecare mașină afișată;
- separat, variația contorului intern, inclusiv compatibilitatea cu rezervările precontorizate.

## Inventarul căilor care pot adăuga o mașină

| Proces | Punctul de intrare | Așteptare |
|---|---|---|
| Intrare cameră cu rezervare eligibilă | `POST /NotificationInfo/TollgateInfo` → serviciul LPR | +1 pe documentul potrivit |
| Intrare cameră fără rezervare eligibilă | Același endpoint → document `unmatched_lpr` | +1 pe o ședere nouă, nu pe rezervarea veche |
| Reintrare fizică după ieșire | Cameră sau `POST /api/admin/manual-lpr-entry` | +1, cu ședere distinctă |
| Intrare manuală pe rezervare existentă | Dialogul comun din Bookings / Intrări-Ieșiri → `manual-lpr-entry` | +1 pentru ședere nouă, 0 pentru corecție |
| Creare manuală cu mașina prezentă | Acțiunea `createManualBooking` → `createManualBookingRecord` | Document, prezență, audit și contor salvate atomic |
| Recuperare automată după eșec temporar | `GET /api/cron/lpr-retry` → procesarea evenimentului salvat | +1 numai când se aplică intrarea, o singură dată |
| Reîncercare cerută de ADMIN | `POST /api/admin/lpr-review`, apoi cron | Cererea de retry: 0; aplicarea intrării: +1 |

Writerul comun al prezenței este `writeLprVisit`. Apelurile care pot produce intrare sunt în serviciul LPR și în cele două fluxuri de intrare manuală. Corecția numărului actualizează referințe, fără să creeze o mașină suplimentară.

Au fost inspectate și scrierile din acțiunile/API-urile Next.js, funcțiile Firebase și aplicația Expo. Acest inventar acoperă procesele aplicației din checkout; intervențiile directe în Firebase Console, alte integrări externe sau scripturi din afara aplicației nu sunt simulate.

## Scenarii incluse

Matricea nouă acoperă rezervări website, Expo, plată la parcare, manuale și statusuri legacy eligibile; lipsa rezervării; rezervări istorice; toate cele trei roluri permise la intrare; intrare manuală/reintrare; creare manuală prezentă/absentă; eroare comercială după salvarea prezenței; camera și manualul simultan; două mașini distincte simultan; rollback și recuperare prin cron; retry cerut de ADMIN.

Include și verificări cu rezultat 0: același mesaj repetat, cadre ulterioare, același număr cu spații/cratime sau citit de altă cameră, whitelist, direcție necunoscută, oră viitoare, asociere ambiguă, intrare veche după ieșire, creare fără autentificare, duplicat la creare, corecție oră/număr, anulare rezervare, heartbeat, ANPR/Hikvision, Metrici și operațiile globale dezactivate.

Celelalte suite selectate verifică protecțiile detaliate ale intrărilor, asocierile și concurența, date invalide, confirmări lipsă, versiuni învechite, ordonarea la schimbarea orei, compatibilitatea camerelor și paritatea contoarelor. Noul set este inclus și în `npm run test:occupancy`.

## Observații și limite

- Writerul existent al rezervărilor website/Expo/pay-on-site poate incrementa separat `parkingLive` înaintea sosirii fizice. Matricea evidențiază explicit această diferență: pagina rămâne la 0; la sosirea reală pagina primește +1, iar cache-ul precontorizat nu mai primește încă +1. Acest set de teste nu schimbă acea convenție.
- Testul rutei Metrici dezactivate a reprodus un răspuns 500 cauzat de `Response("", {status:204})`. Corpul a fost înlocuit cu `null`; contractul rămâne 204 și ruta rămâne dezactivată când configurația o cere.
- Testele nu pot demonstra că o cameră citește fiecare trecere fizică sau că operatorul declară corect prezența. După publicare rămâne necesară verificarea cu o mașină reală și compararea listelor la același moment.
- Nu se repară automat date istorice și nu se publică aplicația.

## Rezultat local — 30.10.2026

`npm run test:occupancy:entries`: **9/9 suite trecute**. Matricea nouă: **26 scenarii / 84 pași cu variația ocupării verificată**, dintre care 27 cu creștere a numărului și 51 cu variație zero; restul verifică plecările necesare pentru reintrare. Setul include suplimentar cele 45 de verificări HTTP ale registrului existent și regresiile asocierii/intrărilor. TypeScript: fără diagnostice noi față de cele 34 preexistente din teste/Stripe. Nicio scriere în producție, nicio publicare.
