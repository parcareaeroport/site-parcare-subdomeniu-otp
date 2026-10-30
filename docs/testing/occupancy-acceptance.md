# Un singur set de acceptare pentru ocupare

Din `next-js`:

```sh
npm run test:occupancy
```

Necesită dependențele proiectului, Firebase CLI în PATH și Java pentru emulator.
Comanda pornește singură un emulator Firestore pe porturi locale libere și îl oprește
la final. Dacă FIRESTORE_EMULATOR_HOST este deja setat, refuză pornirea ca să nu
șteargă fixture-urile unei alte sesiuni. Rularea durează câteva minute; prima poate
descărca emulatorul în cache temporar.

Nu încarcă .env sau service account, folosește exclusiv proiecte demo și nu transmite
credencialele aplicației către suite. În procesele testelor, un guard blochează
HTTP/HTTPS/fetch/socket către gazde externe. Autentificarea criptografică și
transporturile comerciale sunt simulate; regulile de roluri, rutele, serviciile,
tranzacțiile și Firestore din emulator sunt cele ale aplicației.

## Ce verifică

Fluxul HTTP servește pe loopback handlerii reali pentru TollgateInfo, intrări/ieșiri
manuale, corectare număr, ștergere rezervare, cron și GET Ocupare. După fiecare pas
se compară un model explicit al mașinilor fizic prezente în simulare cu:

- lista și numărul din GET Ocupare;
- documentele de rezervare marcate prezente;
- referința șederii pe număr și visitId;
- contorul parkingLive și absența șederilor duble.

Scenarii HTTP: intrare/ieșire/reintrare, retransmitere, combinații manual/cameră,
fără rezervare, whitelist, asociere ambiguă, dialog vechi după reintrare, mesaje
simultane, cron după eroare injectată, schimbarea numărului, ștergere blocată când
mașina este prezentă și corecția orei camerei.

Același set rulează toate cele 8 suite LPR existente, plus verificările orei,
compatibilității camerelor, loggerului, grupării alertelor, afișării orelor și
blocării accesului extern. Suitele existente verifică suplimentar anulări/no-show,
modificări comerciale, corectări istorice, DST, erori de salvare, cron concurent,
60 de pași după model și 12 sosiri simultane. Unele teste verifică direct serviciile
sau funcțiile de fundal; nu toate sunt cereri HTTP. Nu se pretinde testarea
plăților, emailurilor, camerelor fizice ori infrastructurii de producție.

## Raport

Calea este afișată în terminal. Directorul temporar conține:

- `report.md`: rezultate și tabel cu ocupare așteptată/API/contor pentru pașii HTTP;
- `results.json`: fiecare suită, rezultat, durată, scenarii și calea logului;
- `timeline.json`: pașii modelului cu numerele fictive așteptate și observate;
- `source.json`, `source-hashes.json`: commitul și amprentele codului verificat;
- câte un log pentru fiecare suită, fără ascunderea erorilor.

`RECOVERY` evidențiază explicit o diferență temporară când există mesaje pending:
modelul fizic este deja actualizat, dar baza așteaptă retry. Testul avansează doar
programarea evenimentelor sintetice și cheamă cronul real prin HTTP. Invarianta
finală trebuie să coincidă după recuperare; altfel setul eșuează. Nu modificăm
regulile aplicației ca să mascăm aceste diferențe.

Un exit code nenul înseamnă că cel puțin o suită a eșuat. Sunt rulate și celelalte
suite pentru a obține raportul complet. Testele sunt un prag de acceptare logică,
nu dovada că lista reală din parcare coincide cu istoricul din producție. Aceasta
cere inventarierea numerelor și urmărirea trecerilor reale după reconciliere.

## Verificarea din 30 octombrie 2026

Ultima rulare: 15/15 suite trecute, 10 fluxuri HTTP complete și 45 de pași cu
ocupare verificată. Codul aplicației nu a fost modificat pentru a obține rezultatul.
Raportul este în directorul temporar `parking-occupancy-acceptance-8843Cw` afișat de
comandă. Runtime: Node v25.6.1; lansatorul păstrează explicit același executabil
pentru toate suitele și consemnează versiunea în raport.

În rulări intermediare, testul cu două salvări manuale identice simultane a primit
`Transaction is invalid or closed` de la emulator. A trecut ulterior atât izolat
(cu și fără guard), cât și în setul complet, fără relaxarea aserțiunilor. Nu
considerăm acest semnal șters de rezultatul ulterior: logurile intermediare se
păstrează separat și cazul merită urmărit dacă reapare. Nu s-a stabilit că ar fi
un defect de ocupare în producție.

Raport final:
`/var/folders/57/w83hfs491_b5k_d4sw7tq1jh0000gq/T/parking-occupancy-acceptance-8843Cw/report.md`

Raport intermediar cu eroarea concurentă:
`/var/folders/57/w83hfs491_b5k_d4sw7tq1jh0000gq/T/parking-occupancy-acceptance-4QtGII/report.md`
