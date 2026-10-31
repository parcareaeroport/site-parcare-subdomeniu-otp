# Recuperarea șederilor LPR șterse greșit — 31.10.2026

Regulile au fost generalizate și scrierea prezenței a fost centralizată. Pentru acoperirea și verificările actuale, vezi [fluxul manual de prezență](manual-lpr-presence-2026-10-31.md). Modificarea numărului și toleranța de două ore nu mai sunt condiții de recuperare manuală.

## Problema și comportamentul

O mașină poate fi citită de LPR pe numărul corect, dar rezervarea să aibă un număr greșit. Dacă șederea `unmatched_lpr` este ștearsă cu confirmare de absență și apoi numărul rezervării este corectat, intrarea manuală istorică este blocată corect de acea confirmare mai nouă. Operația nouă permite rectificarea explicită a confirmării greșite și recuperarea șederii pe rezervarea corectată.

Dialogul păstrează formularul normal „Înregistrează intrarea”, fără casetă galbenă, selector tehnic sau motiv de completat. Ora citită inițial de cameră este precompletată și poate fi corectată. Angajatul confirmă doar „Mașina este în parcare de la data și ora indicate”, apoi apasă „Salvează”. Modificarea datei/orei anulează confirmarea anterioară.

Pentru o sosire de dinaintea confirmării de absență se folosește recuperarea protejată de condițiile de mai jos. Pentru o sosire ulterioară sau „A sosit acum” se folosește intrarea nouă, fără rectificarea vechii absențe. Aplicația completează automat motivul în audit; backend-ul păstrează cerințele de confirmare, motiv valid și context neschimbat.

## Condiții și protecții

- Rezervare activă cu perioadă validă, fără ședere proprie anterioară și fără altă prezență pentru același număr. Numărul poate fi cel original sau unul corectat.
- Indexul numărului identifică exact o confirmare manuală de absență produsă la ștergere, șederea și documentul arhivat corespunzător. Sursa arhivată trebuie să fie `unmatched_lpr`.
- Sosirea manuală poate fi anticipată sau în afara perioadei planificate, cu prezența confirmată explicit. Ora sosirii introdusă nu poate fi după confirmarea de absență rectificată. Toleranța camerelor rămâne neschimbată.
- Ieșirile reale de cameră, alte confirmări de absență, șederile mai noi sau dovezile contradictorii nu sunt ignorate. Inclusiv o oră introdusă mai devreme este verificată să nu traverseze o ieșire reală anterioară citirii originale.
- Versiunea contextului acoperă rezervarea, prezențele, indexul și evenimentele; versiunea recuperării include și arhiva. Orice schimbare relevantă cere reverificare.
- Autorizarea rămâne pentru `admin`, `employee`, `entriesOperator`; identitatea auditului provine exclusiv din tokenul verificat.

## Tranzacția Firebase

1. Păstrează șederea originală (`visitId`), o leagă de rezervarea cu numărul corect și înregistrează sosirea istorică verificată.
2. Marchează prezența actuală pe rezervare și index. Ultima confirmare de prezență folosește momentul real al recuperării, separat de sosire, cu precizie de milisecunde. Astfel, un mesaj vechi al camerei nu anulează automat decizia operatorului.
3. Rectifică exclusiv evenimentul manual de absență prin `supersededBy`. Păstrează declarația inițială, ștergerea, istoricul arhivat și rezultatul operației originale.
4. Actualizează legăturile operaționale ale evenimentelor șederii și copiază istoricul relevant pe rezervarea corectată. Documentul vechi nu este recreat în `bookings`.
5. Setează contorul derivat la numărul prezențelor efective din același snapshot tranzacțional plus prezența recuperată. Marchează rezervarea astfel încât ieșirea ulterioară să scadă o singură dată.
6. Scrie motivul generat de aplicație, actorul, sursa și evenimentul rectificat în audit. Același `requestId` și același conținut întorc rezultatul inițial fără altă modificare.

Plățile, fidelizarea și operațiile Multipark nu sunt refăcute. Modificarea este exclusiv în Firebase.

## Verificări efectuate

- Regresie completă: **20/20 suite PASS**, 358 checkpoints în rularea cu prima versiune a suitei dedicate (9 scenarii). Raport: `/var/folders/57/w83hfs491_b5k_d4sw7tq1jh0000gq/T/parking-occupancy-acceptance-S8bS4P/report.md`.
- Suita dedicată extinsă: **12/12 scenarii PASS**, inclusiv toate cele trei roluri, cerere repetată, două rezervări concurente, concurență cu o intrare nouă de cameră, ieșire reală/pending, arhivă schimbată, duplicate, rollback, contor istoric inconsistent, citire repetată după recuperare și protecție la antedatarea peste o ieșire reală.
- Browser: angajat la 1440/390 px și operator la 390 px, pagini/API reale în harness izolat. Secvența cameră → ștergere → corectare număr → recuperare → ieșire a produs **ocupare `1 → 0 → 1 → 0`**. Pentru angajat, pagina Ocupare afișează exact o înregistrare recuperată și zero după ieșire. Fără erori de execuție sau cereri către Firebase de producție.
- UX simplificat: **4/4 fluxuri browser PASS** — cele trei recuperări de mai sus și o intrare fizică nouă prin „A sosit acum”. Verificate lipsa casetei galbene/selectorului/motivului, anularea confirmării după editarea orei, selectarea automată a modului corect în cererea API și menținerea ocupării `1 → 0 → 1 → 0`. Hover-ul dropdownului a fost verificat în browser: text alb pe fundal albastru. Tokenul global `--accent-foreground` a fost corectat pentru tema deschisă; tema întunecată păstrează valorile existente.
- TypeScript comparat cu HEAD: **35 diagnostice preexistente / 35 curente, zero diagnostice noi**.
- `git diff --check`: PASS.

Loguri locale: `/tmp/lpr-restoration-focused-complete.log`, `/tmp/lpr-restoration-browser.log`, `/tmp/lpr-restoration-type-comparison.json`. Capturi: `/tmp/lpr-restore-employee-390.png`, `/tmp/lpr-restore-occupancy-390.png`.

Dovezi UX simplificat: `/tmp/lpr-minimal-entry-browser.log`, `/tmp/lpr-minimal-entry-types.log`, `/tmp/lpr-entry-hover.png` și captura actualizată `/tmp/lpr-restore-employee-390.png`.

Comenzi din `next-js`:

```sh
npm run test:occupancy
FIREBASE_EMULATORS_PATH="$PWD/.firebase-emulators" firebase emulators:exec --only firestore --project demo-lpr-restoration --config scripts/fixtures/lpr-emulator/firebase.json 'node scripts/test-lpr-deleted-visit-restoration-emulator.cjs'
FIREBASE_EMULATORS_PATH="$PWD/.firebase-emulators" LPR_RESTORE_FOCUSED=1 firebase emulators:exec --only firestore --project demo-parking-restoration-ui --config scripts/fixtures/lpr-emulator/firebase.json 'node scripts/test-manual-lpr-exit-browser.cjs'
```

Exclusiv date sintetice și emulatoare locale. Verificarea criptografică a tokenului este simulată; autorizarea și tranzacțiile reale sunt exercitate. Fără deploy și fără modificarea cazului real BT25SSI. Nu certifică Firestore Rules sau camerele fizice din producție.
