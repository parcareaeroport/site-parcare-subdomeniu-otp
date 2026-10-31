# Drepturi, corecție număr și asociere LPR — 31.10.2026

## Comportament

- `admin`, `employee` și `entriesOperator` pot pregăti/salva corecția numărului prin API. Intrarea/ieșirea manuală păstrează aceleași trei roluri. Butonul manual din Bookings este disponibil și angajaților; operatorii au editorul de număr în dialogul comun Intrări/Ieșiri. Celelalte drepturi și pagini rămân cele existente.
- O singură ședere `unmatched_lpr`, prezentă și identificată coerent de `lpr_plate_state`, poate fi asociată explicit unei rezervări active, fără istoric de ședere, eligibile la momentul confirmării. Intrarea originală poate fi mai devreme decât perioada rezervării; dialogul avertizează și cere confirmarea aceleiași mașini/șederi.
- Asocierea păstrează ID-ul șederii și orele reale. Mută prezența și responsabilitatea contorului la rezervare, actualizează indexul și legăturile operaționale ale evenimentelor, copiază evenimentele șederii la rezervare și păstrează auditul original. Înregistrarea sursă rămâne istoric, cu `associatedToBookingId`, fără prezență și fără posibilitatea redeschiderii prin operațiile manuale. Completarea unui dialog LPR vechi verifică tranzacțional dacă șederea a fost deja asociată.
- Asocierea aliniază contorul derivat cu același snapshot tranzacțional al prezenței efective folosit de Ocupare. Nu fabrică o ieșire și nu adaugă o mașină. Nu modifică stările LPR ale celorlalte mașini.
- Corecția numărului păstrează rezervarea și `visitId`, mută indexul șederii pe noul număr și păstrează protecția față de citirile întârziate ale numărului vechi. Numărul original și citirile istorice rămân dovezi, nu se rescriu ca și cum camera ar fi citit altceva.
- Se resping șederile multiple/contradictorii, rezervările concurente cu ferestre LPR suprapuse, modificările în curs și confirmările învechite. Corectarea unei rezervări încă absente nu preia șederea unei alte mașini care folosește numărul vechi.

## Verificări

Date exclusiv sintetice, proiecte `demo-*`, emulator Firestore local. Verificarea criptografică a tokenului este simulată; autorizarea reală a rutelor și identitatea din token sunt exercitate.

- Teste API pentru toate cele trei roluri: corecție înainte de intrare, corecție în prezență, asociere, repetarea cererii, audit, ieșire cameră pe numărul nou, fără dublarea prezenței.
- Teste pentru toate combinațiile marcajelor istorice ale contorului, contor deja reconciliat, salvări concurente, context schimbat, ieșire contradictorie, rollback, rezervări suprapuse și păstrarea șederii altei mașini cu numărul vechi.
- Browser, pagini reale și API real în mediul izolat: angajat la 1440/390 px și operator la 390 px; asociere → corecție număr → ieșire cameră. API Ocupare și contor: `1 → 1 → 0`. Pagina Ocupare este verificată separat pentru angajat pe desktop/mobil.

Rezultate obținute:

- 54 scenarii în suita de intrare manuală: PASS; 36 în integritatea ocupării: PASS.
- Cele trei fluxuri browser: PASS, fără erori de execuție sau cereri către Firebase de producție.
- Regresia completă a avut 18/19 suite PASS. Singura excepție a fost testul de ștergere simultană cu ieșire manuală: acesta accepta 200/409, dar ștergerea încheiată prima poate produce corect 404. Așteptarea a fost completată, păstrând verificarea scăderii unice și a absenței finale; suita reluată separat a trecut toate cele 35 de cazuri și 130 de verificări ale ocupării. Nu pretindem o rulare unică verde a comenzii complete după această ajustare exclusiv de test.
- TypeScript: 35 diagnostice la HEAD și 35 cu implementarea, zero diagnostice noi.

Dovezi locale: `/tmp/parking-role-occupancy-browser.log`, `/tmp/parking-role-exit-matrix-confirmed.log`, `/tmp/parking-role-type-comparison-final.json` și raportul complet din `/var/folders/57/w83hfs491_b5k_d4sw7tq1jh0000gq/T/parking-occupancy-acceptance-vQkfBQ/report.md`. Capturi: `/tmp/parking-associate-employee-390.png`, `/tmp/parking-occupancy-corrected-390.png`.

Comenzi reproductibile din `next-js`:

```sh
npm run test:occupancy
FIREBASE_EMULATORS_PATH="$PWD/.firebase-emulators" LPR_ROLE_FOCUSED=1 firebase emulators:exec --only firestore --project demo-parking-roles --config scripts/fixtures/lpr-emulator/firebase.json 'node scripts/test-manual-lpr-exit-browser.cjs'
```

## Limite și stare

Implementare locală; fără deploy sau modificarea rezervărilor reale. Emulatorul nu certifică Firestore Rules, configurația de producție sau camerele fizice.

Conform clarificării utilizatorului din 31.10.2026, corecția numărului se face exclusiv în Firebase, inclusiv legăturile LPR și evidența ocupării. Multipark nu permite această modificare și este exclus intenționat din flux: nu se apelează actualizarea, anularea sau recrearea rezervării externe. Sincronizarea cu Multipark nu este un pas restant al acestei implementări.

Typecheck-ul global are diagnostice preexistente în testele fără tipuri de runner și în integrarea Stripe. Comparația cu sursele HEAD nu a identificat diagnostice noi; rezultatele focalizate și browserul sunt raportate separat.
