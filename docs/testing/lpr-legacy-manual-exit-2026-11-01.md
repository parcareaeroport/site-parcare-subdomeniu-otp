# Ieșire manuală pentru formatul vechi — regresie VN87YLT

## Defect reprodus

Intrarea manuală veche avea `associationStatus=manual`, `deviceId=manual_admin`, `direction=manual`, `matchedBookingId` și ore ISO în `accurateTime`/`snapTime`, dar nu avea `manual=true` sau `eventTime`. Parserul returna o oră necunoscută și verificarea comună refuza atât ieșirea manuală, cât și ieșirea camerei cu `ambiguous_exit_order`.

Referința numărului indica în continuare un alt document, șters din `bookings` și prezent ca închis în `deleted_bookings`. Simplul ocol al verificării temporale ar fi lăsat acea referință nesincronizată după ieșirea manuală.

## Corecție

- Parserul recunoaște la citire numai formatul manual vechi demonstrat: asociere manuală, dispozitiv și direcție manuale, rezervare legată și oră ISO civilă validă. Nu transformă mesaje de cameră/arbitrare în evenimente manuale. Valorile explicite `eventTime` și `eventInstant` păstrează prioritatea; cele invalide rămân refuzate. Nu rescrie istoricul și nu aplică decalajele actuale camerelor vechi.
- Un helper comun pentru ieșirile manuale/cameră citește în tranzacție documentul referit și, dacă lipsește, arhiva. Reconcilierea este permisă numai pentru o singură prezență efectivă, un document arhivat explicit ca șters și închis, același număr și același `visitId`, fără restaurare ulterioară și fără o limită temporală ulterioară/ambiguă față de ieșire.
- Documentele active ale altor șederi nu sunt închise sau suprascrise. Corecțiile unei ieșiri istorice păstrează referința unei șederi mai noi; selecția dintre duplicate păstrează confirmarea existentă și nu repară automat referințe ambigue.
- Pregătirea manuală include și versiunea arhivei în context. Modificarea acesteia după deschiderea dialogului impune reîncărcare.
- Ieșirea, referința închisă, auditul reconcilierii și scăderea existentă a contorului sunt comise în aceeași tranzacție. Arhiva și evenimentele istorice rămân intacte. Repetarea cererii nu scade din nou și nu închide o reintrare ulterioară.
- Noile evenimente manuale folosesc în continuare `manual=true`, `eventTime`, `eventInstant`, `visitId` și identitatea verificată pe server. Nu se schimbă formula paginii Ocupare sau convenția de stocare a orelor.

Nu este necesar un index nou: accesul suplimentar la arhivă este după ID. Contractul HTTP al dialogului și rolurile permise rămân aceleași.

## Verificare

`test-lpr-legacy-manual-exit-emulator.cjs` conține 21 de scenarii, cu date fictive care reproduc schema cazului VN87YLT:

- admin/employee/entriesOperator pot înregistra plecarea reală: Ocupare 1 → 0, referință reconciliată și audit corect;
- aceeași ieșire prin cameră, inclusiv decalajul de 3206 secunde: 1 → 0;
- reîncercare, citire ulterioară a camerei, reintrare și cerere veche repetată: fără scădere dublă sau închiderea șederii noi;
- lipsa provenienței manuale, date invalide, metadate absolute contradictorii, lipsa arhivei, număr/ședere diferite, document referit încă activ, arhivă restaurată sau oră mai nouă: refuz fără scrieri parțiale;
- schimbare de arhivă după pregătire, intrare mai nouă, concurență cameră/manual și eșec de tranzacție;
- orele originale, arhiva și evenimentele vechi nu se modifică.

Suita este inclusă în `npm run test:occupancy`, `npm run test:occupancy:entries` și `npm run test:occupancy:exits`. Identitatea criptografică este simulată; rolurile, endpointurile și tranzacțiile Firestore rulează efectiv în emulator. Nu se contactează producția.

## Publicare și operare

Modificarea este locală până la publicare. După publicare, operatorul trebuie să redeschidă dialogul și să confirme ora reală a plecării. Nu se reprocesează automat evenimentul camerei deja trimis la verificare și nu se înregistrează ieșiri pentru mașini reale în timpul testelor. Cazurile fără dovezi suficiente rămân pentru verificare ADMIN.

## Rezultat local

01.11.2026: `npm run test:occupancy` a trecut **21/21 suite**, inclusiv **21 de scenarii noi** pentru compatibilitatea manuală și reconcilierea referinței. Matricele generale de intrare/ieșire, restaurarea șederilor, asocierile, validările DST, rollback-ul și protecțiile manuale au trecut. TypeScript nu introduce diagnostice noi față de cele 34 preexistente din teste/Stripe. Nicio înregistrare de producție nu a fost modificată și aplicația nu a fost publicată în această verificare.
