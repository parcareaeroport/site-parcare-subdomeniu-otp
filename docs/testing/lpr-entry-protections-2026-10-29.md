# Protecții pentru intrări și afișarea LPR — 29 octombrie 2026

Modificări locale, după auditul proceselor care pot adăuga prezență. Nu s-au modificat date de producție și nu s-a publicat aplicația.

## Comportamentul implementat

- Camerele și intrările manuale folosesc aceleași reguli pentru o ieșire deja primită ulterior și pentru limita temporală a unui număr corectat. Intrarea manuală verifică, în tranzacție, inclusiv ieșirile în așteptare; nu inventează prezență înaintea rezolvării contradicției. Recuperarea automată a cozii camerelor își păstrează ordinea existentă.
- Rezervarea manuală nu presupune prezența. Operatorul alege explicit Da/Nu; serverul respinge lipsa valorii sau alte valori, înainte de Firestore și transportul Multipark. La redeschiderea formularului alegerea este din nou necompletată.
- Corectarea orei unei intrări prezente modifică doar ora sosirii și metadatele corecției. Păstrează `visitId`, `lastSeenAt`, `departedAt`, referința numărului și contorul. Auditul este `arrival_correction`, cu valorile LPR anterioare, identitatea verificată și confirmarea operatorului; nu este o nouă trecere prin poartă.
- Înainte de corecție verificăm că aceeași înregistrare rămâne efectiv prezentă. Dacă precizia istorică face corecția contradictorie, operația este respinsă fără scrieri. Cazul reprodus cu ieșire la .500 și ultimă intrare la .900 păstrează acum prezența și observația exactă.
- O rezervare închisă nu se redeschide prin modul de corecție. Intrarea nouă cere confirmarea reintrării fizice dacă există urmele unei șederi anterioare, inclusiv când orele istorice sunt invalide/lipsesc. Reintrarea în aceeași secundă cu ieșirea rămâne ambiguă și este blocată.
- În Ocupare afișăm ceasul civil România păstrat de scriitorii LPR existenți, fără a adăuga încă o dată +2/+3 ore. Aceeași convenție este folosită pentru avertismentul „în afara perioadei” și la printare. Nu s-a convertit niciun document istoric.
- „Completează rezervare din LPR” spune acum explicit „ieșire programată” și explică faptul că plecarea reală se înregistrează separat.

## Verificări

Date sintetice în proiecte Firestore emulator `demo-*`, host local 127.0.0.1:8189. Nicio rezervare reală, plată sau cerere reală către Multipark. Testul acțiunii de creare execută corpul real al acțiunii, cu transportul extern simulat.

| Suită | Scenarii |
| --- | ---: |
| Asociere LPR existentă | 24 |
| Ieșiri manuale protejate | 27 |
| Intrări manuale + creare rezervare | 38 |
| Ocupare unificată | 7 |
| Integritate, concurență, anulare, modificări | 36 |
| Ordine evenimente și corectarea numărului | 18 |
| Noile regresii pentru intrări | 22 |
| **Total emulator** | **172** |

În plus: 27 teste forecast, 25 verificări de afișare LPR, 10 verificări pentru revizuirea evenimentelor și 11 teste pentru logica emailului de review.

Noile regresii acoperă: ieșiri neasociate/pending/verificate primite înaintea intrării, recepție sosită după deschiderea dialogului, vechi recepții manuale fără `eventTime`, ceasuri respinse, limita numărului corectat la intrare și creare, reutilizarea legitimă ulterioară a numărului, confirmarea reintrării, precizia la secundă/milisecundă, corecție fără schimbarea prezenței, idempotență, ieșire de cameră simultană cu intrarea manuală, lipsa alegerii prezenței în serviciu și în acțiunea server.

Browser: paginile reale Bookings, Intrări/Ieșiri și Ocupare, API-urile reale și emulator, cu autentificare fixture. Verificat la 1440 și 390 px, inclusiv browser America/Los_Angeles, print media, alegerea explicită Da/Nu, corecția fără schimbarea șederii/contorului, reintrarea fără confirmare blocată, erori păstrate în dialog, duplicate, conflicte, refresh și avertismentele LPR. Fără erori JavaScript sau cereri către Firebase de producție. Crearea manuală prin transport extern nu este exercitată din browser; este verificată separat prin acțiunea server și emulator.

La o rerulare a suitei de ieșiri, testul „concurrent identical requests decrement once” a întâlnit `INVALID_ARGUMENT: Transaction is invalid or closed` emis de emulator în `runQuery`. Logul este păstrat în `/tmp/parking-entry-fixes-manual-exit-transient-failure.log`. Suita trecuse anterior și a trecut integral la reluare, fără schimbarea validărilor sau mascarea erorii. Nu am stabilit că eroarea poate apărea și în Firestore de producție; nu pretindem că toate rulările au fost fără incidente. Rezultatele din tabel sunt cele finale.

TypeScript: 34 diagnostice înainte și după, identice după eliminarea numerelor de linie; zero diagnostice noi. Erorile preexistente sunt în tipurile testelor și integrarea Stripe. Nu afirmăm un typecheck global verde sau un build de producție validat.

## Reproducere și dovezi locale

- `FIRESTORE_EMULATOR_HOST=127.0.0.1:8189 node scripts/test-lpr-entry-protections-emulator.cjs`
- `FIRESTORE_EMULATOR_HOST=127.0.0.1:8189 node scripts/test-manual-lpr-entry-emulator.cjs`
- `FIRESTORE_EMULATOR_HOST=127.0.0.1:8189 node scripts/test-manual-lpr-exit-browser.cjs`
- Suitele care folosesc același proiect emulator se rulează succesiv, deoarece își resetează fixture-urile.
- Loguri: `/tmp/parking-entry-fixes-*.log`; comparație TypeScript: `/tmp/parking-entry-fixes-tsc-comparison.json`.
- Capturi: `/tmp/parking-explicit-presence-1440.png`, `/tmp/parking-explicit-presence-390.png`.

## Limite rămase

Testele confirmă scenariile simulate, nu prezența fizică. O cameră care omite o trecere, un număr OCR greșit sau o confirmare manuală eronată pot produce în continuare diferențe. Politica vehiculelor whitelist trebuie stabilită cu operatorul. Datele istorice greșite și eventualele timestampuri istorice cu altă convenție necesită verificare individuală; această schimbare nu le repară automat. Corecția orei păstrează validările conservative privind evenimentele mai recente și nu este un editor liber al istoricului.

Frontendul și endpointul pentru intrarea manuală trebuie publicate împreună; o interfață veche care nu trimite intenția explicită primește eroare de validare. Publicarea, verificarea camerelor reale și reconcilierea listei fizice rămân separate.
