# Integritatea ocupării — etapa 3, 29 octombrie 2026

Implementare locală pornită de la `a544d58`. Nu s-au publicat modificări și nu s-au citit/modificat documente de producție în această etapă. Fișierele bannerului de parcare și testele lui, modificate separat în workspace, nu fac parte din acest lot.

## Ce s-a schimbat

1. **Ștergere / număr de înmatriculare.** Ștergerea este blocată când documentul indică prezență, înainte de apelul extern și din nou în tranzacția finală. Arhiva păstrează dovezile reale, fără fabricarea unei ieșiri. Editorul de număr folosește acum un endpoint admin cu pregătire, versiune a contextului, verificare de duplicate și confirmarea explicită a corectării aceleiași mașini prezente. Documentul, referința șederii pe numărul nou, închiderea referinței vechi și auditul se actualizează atomic; numărul de locuri ocupate nu se schimbă. Fluxul general de modificare nu poate schimba implicit numărul unei mașini prezente; un conflict apărut după apelul extern este marcat pentru recuperare, fără eliminarea prezenței.
2. **Ieșire manuală.** Se verifică și ultima detectare de intrare, nu doar prima intrare. Dialogul o arată separat când diferă. Corectarea unei ieșiri istorice nu poate intra în perioada unei șederi mai noi, nici când aceasta este deja închisă. Nu se întoarce în trecut ordinea evenimentelor din referința șederii.
3. **Căi vechi.** Au fost eliminate scrierea simulatorului în Firebase și ștergerea directă din dialogul debug. Simularea locală și vizualizarea diagnosticului rămân. Operațiile globale `reset`, `set_all_outside` și inversările lor returnează 410; recalcularea verificată rămâne disponibilă. Auto-anularea no-show recitește rezervarea și configurația în tranzacție, se activează doar explicit și nu scrie LPR sau contorul. Varianta veche de auto-ieșire din cleanup a fost eliminată.
4. **Camere / recuperare.** Callbackul Tollgate verifică secretul și dispozitivul configurat. Salvează o recepție durabilă, cu identificator determinist, înainte de confirmare. Eșecul acestei salvări răspunde 503, pentru retransmitere. Procesarea este atomică și repetabilă fără dublare. Erorile temporare rămân în așteptare, se reiau cu pauze crescătoare, iar după 10 încercări sunt trimise la verificare. O ieșire așteaptă intrarea anterioară neprocesată. Un eveniment vechi/incomplet nu blochează întregul worker. Datele viitoare/invalide și backlogul prea vechi nu creează prezență automată.
5. **Whitelist.** O mașină deja numărată poate fi închisă corect la ieșire chiar dacă între timp este adăugată în whitelist, inclusiv în lista statică. Numerele excluse înaintea unei șederi rămân excluse când nu există o ședere deschisă numărată.

Ocupare afișează evenimentele `pending` / `needs_review` sub „Necesită verificare ADMIN”, cu explicații, perioadă/oră și documente candidate. Confirmarea verificării necesită notă, confirmare explicită și context neschimbat; se păstrează audit. Ea nu modifică implicit prezența. Corectarea efectivă a șederii se face prin dialogurile protejate. Lista arată primele 50 de evenimente și numărul total; următoarele devin vizibile după soluționare.

## Convenția orelor și configurarea necesară înainte de publicare

Nu s-au convertit date istorice. Stocarea LPR rămâne ceasul civil România etichetat cu `Z`. Fiecare dispozitiv trebuie configurat explicit:

- `romania_wall_clock`: camera trimite ora locală România fără offset sau cu eticheta `Z` folosită istoric; offseturile nenule sunt respinse pentru a nu ghici.
- `instant`: camera trimite un instant real cu `Z` / offset explicit; serverul îl normalizează la convenția existentă România. Un instant fără offset este respins.
- `maxEventAgeMinutes`: opțional; implicit 1440 (24 ore). Recepțiile mai vechi sunt păstrate pentru verificare, fără declararea automată a unei prezențe actuale. Limita privește primirea inițială; un eveniment deja salvat nu expiră în timpul reluărilor.

Ora repetată la schimbarea orei nu poate fi distinsă întotdeauna în datele istorice cu precizie doar de ceas local. Ordinea contradictorie este semnalată, fără migrare/ghicire automată.

Configurație de exemplu, **nu valori publicate**:

```text
LPR_AUTH_SECRET=<secret configurat atât pe emitent cât și pe server>
LPR_DEVICES_JSON={"intrare_1":{"direction":"entry","timestampMode":"romania_wall_clock"},"iesire_1":{"direction":"exit","timestampMode":"romania_wall_clock"}}
CRON_SECRET=<secret pentru worker>
```

Camerele sau gateway-ul trebuie să trimită `Authorization: Bearer <LPR_AUTH_SECRET>`. Dispozitivele reale și formatul lor de timp trebuie verificate înaintea activării. Fără configurarea secretului/dispozitivelor, callbackul răspunde 503; un emitent neautorizat primește 401, un dispozitiv necunoscut 403. Secretul nu este acceptat în URL și nu se salvează în recepții. Payloadul brut salvat conține metadatele Plate/SnapInfo, nu imaginile.

`vercel.json` definește workerul `/api/cron/lpr-retry` la fiecare minut. La publicare trebuie verificată disponibilitatea acestei frecvențe pentru proiect și configurat `CRON_SECRET`; workerul refuză apeluri fără secret. Poate fi apelat de un scheduler autorizat echivalent. Funcția Firebase `autoExitPayOnSite` trebuie publicată separat de Next.js dacă se dorește protecția ei nouă. Nu au fost schimbate setările active din cloud.

Nu este introdusă o nouă colecție principală: se reutilizează `lpr_events`, `lpr_plate_state`, `bookings`; auditul corectărilor numărului este în `bookings/{id}/plateCorrections`. Noile interogări sunt pe un singur câmp; interogarea existentă `status + endDate` a asociatorului își păstrează cerința de index. Emulatorul nu dovedește configurația indexurilor publicate.

## Verificări locale

Toate datele sunt sintetice, în Firestore Emulator `127.0.0.1:8189`, proiectele `demo-parking-lpr` și `demo-parking-integrity`. Suitele care folosesc același proiect au rulat secvențial. Transporturile Multipark/email și verificarea criptografică a identității admin sunt fixture-uri; regulile rolurilor, serviciile, tranzacțiile, endpointurile și paginile sunt codul real. Testele comerciale folosesc un ceas de eligibilitate fix și rezultate externe simulate; nu sunt apeluri de producție.

| Verificare | Rezultat |
| --- | --- |
| Integritate nouă (`test-occupancy-integrity-emulator.cjs`) | 36 scenarii |
| Asociere cameră / reintrare / concurență | 24 scenarii |
| Ieșire manuală protejată | 27 scenarii |
| Intrare manuală / creare rezervare / API extern simulat | 33 scenarii |
| Ocupare comună / contor / recitire | 7 scenarii |
| Forecast | 27 teste |
| Afișare LPR | 22 verificări |
| Reguli de verificare ADMIN | 10 verificări |
| Reguli existente email după vizită | 11 teste |

Cele 36 de scenarii noi includ un model cu **60 de operațiuni** alternând cameră, manual și retransmitere, verificând lista, contorul și referințele după fiecare pas. Include și **12 intrări / ieșiri simultane**, cu retransmiteri și reluări. Aceste scenarii au convergat la numărătoarea așteptată, fără pierderi sau dublări. Sunt testate erori de stocare, 10 procesări eșuate consecutiv, recuperarea lor, intrarea înainte de finalizarea ștergerii, schimbarea șederii după verificarea numărului, anularea no-show concurentă, whitelist adăugat în timpul șederii și corecția istorică în conflict cu o ședere nouă.

Browser: paginile reale Intrări/Ieșiri, Bookings și Ocupare, la 1440 și 390 px; browser în alt fus orar; blocări pentru duplicate/date/context schimbat, confirmări explicite, afișarea excepțiilor, rezoluție cu audit, actualizare automată și recuperare după 503 / timeout. Fără erori runtime și fără cereri către Firebase de producție. Capturile pentru dialogurile noi au fost inspectate vizual.

Lint pentru `functions/index.js` și `functions/pay-on-site-no-show.js`: trecut. Verificarea TypeScript globală păstrează 34 de diagnostice existente în testele vechi și tipurile Stripe; nu este prezentată ca un typecheck global verde. Comparația elimină doar prefixul checkout-ului temporar și numerele de linie. Paginile modificate au fost compilate de harnessul Next în browser; nu s-a rulat un build de producție care ar putea evalua rute cu servicii reale.

Loguri locale: `/tmp/parking-stage3-{integrity,association,exit,entry,unified,browser,forecast,display,admin-review,review-email,tsc}.log`. Capturi: `/tmp/parking-stage3-plate-1440.png`, `/tmp/parking-stage3-plate-390.png`, `/tmp/parking-stage3-review-mobile.png`.

## Ce nu demonstrează testele

Nu există garanție că numărul fizic va fi mereu exact. Pot exista citiri greșite ale numărului, evenimente care nu ajung deloc la server, operațiuni manuale confirmate greșit și date istorice încă nereconciliate. Cazurile ambigue rămân vizibile pentru verificare; nu se inventează automat intrări/ieșiri. Un panou fără excepții nu dovedește că o cameră nu a ratat complet un eveniment.

Nu au fost verificate hardware-ul, rețeaua, retransmiterea efectivă la 503, configurația din cloud, regulile Firestore publicate sau scrierile făcute din alte sisteme/versiuni vechi. Regulile Firestore nu sunt în acest checkout; blocarea UI/endpointurilor nu dovedește că o scriere directă din alt client ar fi refuzată de regulile active. Endpointurile ANPR/Hikvision de logare nu sunt echivalente cu procesarea Tollgate. Aceste verificări și o reconciliere fizică pe numere rămân necesare la lansare.
