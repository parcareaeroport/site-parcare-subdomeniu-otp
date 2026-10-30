# Protecții la ieșire și ordonare LPR — 29 octombrie 2026

Implementare locală, pornită de la `3fe56e4`. Nu s-au publicat schimbări, nu s-au citit/modificat date de producție și nu s-a reconciliat automat istoricul. Testele folosesc doar date sintetice, Firestore Emulator și identități de test.

## Comportamentul corectat

1. **Ieșire veche după reintrare neasociată.** Camera, workerul de reluare și ieșirea manuală folosesc aceeași validare a dovezilor. O intrare ulterioară, inclusiv `pending`, `needs_review` sau `reviewed`, împiedică închiderea printr-o ieșire anterioară. Intrările simultane neasociate cer verificare. Ceasurile respinse ca invalide/în viitor nu devin dovezi valide ulterior.
2. **Dialog rămas deschis.** Versiunea include și recepțiile LPR și istoricul pentru număr, citite în tranzacție. O recepție nouă invalidează dialogul chiar dacă nu a modificat încă rezervarea. După reîncărcare se aplică din nou verificările; reîncărcarea nu ocolește contradicția.
3. **Corectarea ieșirii.** Pentru aceeași ședere închisă, rezervarea și referința ei primesc ora corectată, inclusiv când este mai devreme. Auditurile ieșirii înlocuite păstrează datele originale, cu `supersededBy`, `supersededAt`, `supersededByUid`; noul audit păstrează `supersedes` și `previousLpr`. Dovada înlocuită nu mai blochează reintrarea. O referință către altă ședere nu se modifică. Corecția nu poate suprapune șederi ulterioare și nu scade din nou ocuparea.
4. **Date contradictorii.** Tipurile de eveniment se normalizează identic. O referință mai nouă/incompatibilă cu documentul, un alt `visitId` sau un moment absolut incompatibil cu ora afișată blochează ieșirea. Confirmarea duplicatelor nu autorizează închiderea tuturor documentelor.
5. **Schimbarea orei.** Ordonarea folosește momentul absolut, separat de ora civilă păstrată pentru compatibilitate. O intrare la 03:50 înainte de schimbarea orei și o ieșire la 03:10 după schimbare sunt tratate în ordinea reală, când sursa furnizează momente exacte. O ieșire veche nu închide o reintrare mai nouă doar fiindcă ora afișată pare mai mare. Aceeași regulă acoperă reluările și limita unei corecții de număr.

## Compatibilitate și câmpuri noi

- Câmpurile existente `arrivedAt`, `departedAt`, `lastSeenAt`, `lastEventAt`, `eventTime` rămân ore civile din România, cu convenția istorică de etichetare `Z`. Nu sunt migrate.
- Evenimentele noi salvează `eventInstant`; rezervarea salvează `arrivedAtInstant`, `departedAtInstant`, `lastSeenAtInstant`; referința șederii salvează `lastEventAtInstant`. Corecția numărului salvează `plateCorrection.throughInstant`. Scrierile de ședere păstrează și identificatorul ultimului eveniment.
- Pentru surse `instant`, se păstrează momentul și offsetul interpretat din mesaj. Pentru `romania_wall_clock`, conversia este acceptată numai dacă există un singur moment posibil în `Europe/Bucharest`.
- Ora repetată introdusă manual și ora inexistentă primăvara cer verificare. Acțiunea „A plecat acum” folosește momentul serverului, capturat o singură dată. Nu folosește fusul browserului.
- Un istoric fără moment absolut este comparat numai când ordinea poate fi demonstrată pentru toate momentele posibile. În ora ambiguă nu se inventează un offset.
- Nu se schimbă autentificarea, calculul capacității rezervărilor/Expo, tarifarea sau regula de numărare a documentelor efectiv prezente. Durata unei șederi LPR fără rezervare folosește timpul real scurs când acesta poate fi determinat.
- Nu sunt necesare indexuri compuse noi: citirile adăugate folosesc egalitate pe un singur câmp (`normalizedPlate`, respectiv `licensePlate`). Nu s-au modificat regulile Firestore sau configurația camerelor.

## Verificare

Au trecut **211 scenarii în emulator**:

| Suită | Scenarii |
| --- | ---: |
| Ieșiri manuale, API și autorizare | 27 |
| Asociere cameră și SDK-uri reale | 24 |
| Integritate, concurență, anulare, modificare, whitelist, model de 60 de pași | 36 |
| Ordonare și corecții de număr | 18 |
| Protecții pentru intrări | 22 |
| Intrări manuale și creare manuală | 38 |
| Ocupare unificată și contor | 7 |
| Regresii noi pentru ieșiri și schimbarea orei | 39 |

Regresiile noi acoperă cele patru probleme reproduse în audit, tranzacții anulate, corecții repetate, lipsa `visitId`, lipsa referinței, audit vechi fără `visitId`, reintrare concurentă, duplicate, ieșire cameră/manual simultană, metadate invalide, ambele schimbări de oră, momente identice ca oră civilă dar diferite în realitate, offset explicit, milisecunde și browsere/calculatoare în alte fusuri.

Au trecut separat **82 verificări** pentru avertismente ADMIN, afișarea orelor, forecast/contractul Expo și sumarul parcării pline (10 + 25 + 27 + 20).

Browserul Chrome a verificat paginile reale **Intrări/Ieșiri, Bookings și Ocupare**, la 1440 px și 390 px, inclusiv un browser în `America/Los_Angeles`. Au trecut salvarea normală, corectarea ieșirii, confirmările, conflictele și reîncărcarea contextului, păstrarea valorilor după eroare, mesajele pentru reintrare neasociată și ora repetată, afișarea la printare, actualizarea ocupării și autorizarea operatorului. Fără erori JavaScript sau acces la Firebase de producție în browser.

Verificarea TypeScript completă are aceleași **34 de erori preexistente**, fără diferențe față de captura de dinaintea schimbării. Nu este raportată drept verificare completă TypeScript reușită. Paginile testate au fost compilate în aplicația Next izolată pentru browser. `git diff --check` trece.

Două așteptări din testele vechi au fost actualizate intenționat: o recepție nouă cere acum reîncărcarea contextului, iar corecția unei ieșiri închise actualizează ora aceleiași șederi în referință. Protecția referințelor către alte șederi rămâne testată separat.

## Rulare și dovezi

Emulator local pe `127.0.0.1:8189`, Java 17, configurația `scripts/fixtures/lpr-emulator/firebase.json`. Scripturile refuză rularea fără emulator local. Suitele care împart proiectul `demo-parking-lpr` se rulează succesiv; celelalte au proiecte `demo-*` distincte.

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8189 node scripts/test-lpr-exit-protections-emulator.cjs
FIRESTORE_EMULATOR_HOST=127.0.0.1:8189 node scripts/test-manual-lpr-exit-browser.cjs
```

Loguri locale: `/tmp/parking-exit-fixes-{regression,manual,association,manual-entry,unified,integrity,entry-protections,ordering,browser}.log`. Capturi ale noului mesaj: `/tmp/parking-exit-guard-1440.png` și `/tmp/parking-exit-guard-390.png`. TypeScript: `/tmp/parking-exit-before-tsc.log`, `/tmp/parking-exit-final-tsc.log`.

## Ce mai trebuie verificat după publicare

- O intrare și o ieșire reale prin fiecare cameră, apoi o ieșire manuală, comparate cu mașinile din teren și cu pagina Ocupare.
- Convenția efectivă a orei trimise de fiecare cameră. Dacă trimite doar ora civilă fără offset, ora repetată necesită verificare; aplicația nu poate recupera informația absentă din mesaj.
- Recepția evenimentelor, accesul autorizat și funcționarea workerului de reluare în producție.
- Datele istorice contradictorii se reconciliază separat, pe document și după confirmarea operatorului. O citire OCR greșită, o ieșire ratată sau o confirmare manuală greșită pot produce în continuare diferențe față de teren. Aceste teste nu afirmă că baza de date dovedește singură prezența fizică.
