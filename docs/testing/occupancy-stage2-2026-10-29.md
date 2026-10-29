# Etapa 2 — protecții la modificarea prezenței LPR

Implementare locală, 29 octombrie 2026. Fără publicare și fără modificări de date în producție.

## Comportament

- Camera, intrarea manuală, ieșirea manuală și crearea manuală cu prezență folosesc `lib/lpr-visit.server.ts` pentru actualizarea rezervării, șederii pe număr și contorului. Auditul se scrie în aceeași tranzacție.
- Intrarea manuală din Bookings / Intrări-Ieșiri folosește noul endpoint autentificat `POST /api/admin/manual-lpr-entry`. Nu mai există vechiul writer LPR prin SDK-ul client.
- La deschidere se citește contextul curent. La salvare se verifică versiunea rezervării, șederea și duplicatele. Un context schimbat obligă operatorul să reîncarce.
- O altă rezervare efectiv prezentă pentru același număr normalizat blochează intrarea, inclusiv două încercări simultane. Se afișează documentele care necesită verificare ADMIN.
- Se resping data/ora invalide, viitorul și intrările anterioare unui eveniment cunoscut mai recent. O nouă prezență trebuie să corespundă unei rezervări active și ferestrei acesteia, cu aceeași toleranță de 120 minute ca la cameră. Documentele LPR fără rezervare nu au această fereastră.
- Corectarea intrării unei șederi deja deschise cere confirmare și nu mai adaugă un loc. Reintrarea creează un `visitId` nou și golește ieșirea precedentă. Repetarea aceleiași cereri de intrare nu repetă auditul sau incrementarea.
- Crearea manuală cu „mașina este înăuntru” înregistrează sosirea la ora serverului și refuză duplicatul înainte de crearea documentului și de apelul Multipark. Fără această bifă, rezervarea nu creează prezență LPR.
- Meniul Bookings „Marchează ieșire” deschide dialogul protejat existent. Ieșirea afectează numai documentul confirmat.
- Ocupare reîncarcă lista și numărul din același răspuns la 15 secunde, când pagina este vizibilă, și la revenire în pagină / online. Cererile suprapuse și răspunsurile vechi sunt protejate. Un răspuns blocat este abandonat după 12 secunde; lista anterioară se păstrează cu avertisment până la recuperare. API-ul și fetch-ul folosesc `no-store`.

## Verificări

Toate testele cu Firestore au folosit exclusiv emulatorul local `127.0.0.1:8189`, proiectul sintetic `demo-parking-lpr`. Suitele se rulează consecutiv deoarece resetează acest proiect.

| Suită | Rezultat |
| --- | --- |
| `scripts/test-lpr-association-emulator.cjs` | 24 scenarii trecute |
| `scripts/test-manual-lpr-exit-emulator.cjs` | 27 scenarii trecute |
| `scripts/test-manual-lpr-entry-emulator.cjs` | 33 scenarii trecute |
| `scripts/test-unified-occupancy-emulator.cjs` | 7 scenarii trecute |
| `scripts/test-occupancy-lpr-display.cjs` | 22 verificări trecute |
| `scripts/test-lpr-admin-review.cjs` | 10 verificări trecute |
| `scripts/test-occupancy-forecast.cjs` | 27 teste trecute |
| `scripts/test-manual-lpr-exit-browser.cjs` | Cele trei pagini reale, desktop 1440 px și mobil 390 px; browser și fus orar străin |

Scenariile noi includ intrare manuală → ieșire cameră, intrare cameră → ieșire manuală, reintrare, context expirat, duplicate normalizate, operațiuni concurente, repetarea cererii, lipsa `visitId`, date invalide, rezervări anulate sau din altă perioadă, rollback la eroare de tranzacție și identitatea verificată pentru audit.

Pentru crearea manuală, testul execută corpul funcției reale `createManualBooking`, extras din sursă, cu Firestore și autorizarea reale din proiect. Transportul Multipark este simulat: succes și eroare. Nu s-au făcut rezervări externe, trimis emailuri sau folosit date reale. Verificarea criptografică a tokenului este înlocuită cu tokenuri de test; verificarea rolurilor din aplicație este reală.

Browserul folosește paginile și endpointurile reale într-o aplicație Next izolată, cu autentificare de test și Firebase emulator. Verifică ieșirea prin meniul vechi, confirmările, păstrarea valorilor la eroare, blocarea duplicatelor la intrare, datele în ora României inclusiv cu browser America/Los_Angeles, actualizarea automată, eroarea de rețea, timeoutul și recuperarea. Fără erori JavaScript sau cereri către Firebase de producție.

`tsc --noEmit --incremental false`: 34 diagnostice, identice cu cele dintr-o copie curată a HEAD-ului inițial. Niciun diagnostic nou. Problemele existente sunt tipurile de test runner din `__tests__` și două incompatibilități Stripe. `git diff --check` trece.

## Limite și următoarea etapă

- Nu s-au schimbat calculul disponibilității Expo/forecast, interpretarea istorică a orelor sau regulile de plată. Convenția LPR existentă de oră civilă a României etichetată cu Z se păstrează.
- Nu sunt necesare indexuri compuse noi pentru aceste modificări: intrările manuale folosesc interogări pe câte un câmp și documentul existent `lpr_plate_state/{număr}`. Emulatorul nu certifică disponibilitatea indexurilor cerute deja de codul camerelor în producție.
- Contorul separat păstrează compatibilitatea cu `occupancyIncremented` / `occupancyDecremented`. Alte fluxuri încă pot incrementa acel cache la crearea rezervării; etapa aceasta nu îl transformă într-un inventar fizic. Pagina Ocupare numără documentele efectiv prezente din propria listă.
- Protecția împotriva duplicatelor acoperă fluxurile de intrare modificate aici. Schimbarea numărului unei mașini prezente, ștergerile, resetările istorice, funcțiile de auto-anulare și simulatorul persistent sunt fluxuri distincte, inventariate în etapa 1, care necesită tratare separată.
- Diferențele de filtre dintre Bookings și Ieșiri întârziate, tratarea evenimentelor `needs_review`, politica whitelist și reconcilierea datelor istorice rămân etape separate.
- Testele nu certifică livrarea evenimentelor de către camerele fizice, Firestore Rules sau integrarea externă Multipark. După publicarea separată: verificare controlată la barieră, inventar fizic pe numere la același moment și monitorizarea excepțiilor. Nu se modifică arbitrar un total ca să coincidă cu o numărătoare de la altă oră.
