# Ștergere și corecție a prezenței

## Operator

În Bookings, „Șterge” pregătește pe server contextul rezervării. Pentru o rezervare prezentă este obligatorie confirmarea „Confirm că mașina nu mai este fizic în parcare”. Butonul devine „Scoate din evidență și șterge”. Duplicate, referințe contradictorii sau o ședere schimbată blochează operația; dialogul păstrează eroarea și permite reîncărcare.

Rezervarea este arhivată în `deleted_bookings`, nu distrusă. Nu efectuați această operație pentru o mașină încă fizic în parcare.

## Contract și consistență

`POST /api/admin/bookings/delete`, autentificare admin existentă:

- `{action:"prepare", bookingId}`: context fără scrieri și fără apel extern; include `version`, `inside`, `blockedReason` și identificarea rezervării.
- `{action:"save", bookingId, version, requestId, confirmNotPresent}`: confirmare idempotentă. `requestId` este păstrat la reîncercarea unei cereri cu răspuns pierdut. Reîncărcarea contextului creează o cerere nouă.
- Contractul vechi `{bookingId}` rămâne disponibil numai pentru documente neprezente; nu înregistrează ieșire.

Anularea Multipark păstrează coordonarea existentă, înaintea tranzacției finale. Un rezultat incert nu închide prezența. Dacă șederea se schimbă în timpul apelului extern, rezervarea rămâne local; un succes extern deja confirmat este memorat și nu se retrimite automat.

Tranzacția finală recitește contextul (inclusiv evenimentele/referința/documentele aceleiași mașini) și salvează împreună arhiva, auditul, referința închisă, eventuala scădere și eliminarea documentului activ. Metadatele propriei anulări sunt singurele excluse din amprenta versiunii. Prezența reală este confirmată de operator, nu dedusă din expirarea rezervării.

`presence_correction` este un eveniment administrativ de absență, nu o trecere fizică. Auditul păstrează administratorul, momentul verificării, șederea și starea LPR anterioară. `arrivedAt`, `departedAt` și orele originale nu sunt rescrise. Referința închisă păstrează limita de ordonare; și auditul corecției este considerat dovadă de absență la verificarea intrărilor vechi, inclusiv după o ședere ulterioară.

Scăderea folosește aceeași funcție ca ieșirile LPR: numai prezență efectivă + incrementare anterioară + lipsa unei scăderi anterioare. Nu se repară automat un contor istoric nesincronizat. Repetarea cererii citește rezultatul arhivat și nu modifică din nou ocuparea sau punctele.

Nu sunt necesare colecții sau indexuri compuse noi. Sunt folosite colecțiile existente și interogări pe câte un câmp.

## Verificare

`npm run test:occupancy` include acum:

- `test-booking-deletion-emulator.cjs`: 19 scenarii pentru endpointurile reale admin/cameră/ocupare în Firestore emulator; include refuzuri, reintrare, duplicate, concurență, rollback, anulare externă incertă, reîncercări, fidelitate și sosire nouă după arhivare.
- `test-booking-delete-feedback.cjs`: execută handlerul real al dialogului cu răspunsuri sintetice; verifică bifa, conflictul, eroarea de rețea, succesul și nerepetarea după succes.

Transportul Multipark și verificarea criptografică a tokenului sunt simulate; rolurile, endpointurile și operațiile Firestore rulează efectiv. Setul refuză Firestore în afara emulatorului local. Verificarea vizuală folosește componenta reală, cu răspunsuri fictive locale, pe desktop și într-un viewport de 390px.

Publicarea și operațiile asupra datelor reale sunt separate. După publicare trebuie verificat fluxul în mediul administrativ cu o înregistrare de test identificată explicit, fără a marca drept absentă o mașină prezentă fizic.

Rezultat local, 30.10.2026: setul complet 17/17 suite trecut, apoi scenariile finale de ștergere 19/19 trecute; 28/28 regresii de fidelitate trecute. Dialogul a fost verificat în Safari cu date fictive (confirmare, succes, conflict, reîncărcare, înregistrare neprezentă și blocare ADMIN), inclusiv la 390px. TypeScript nu introduce diagnostice noi; cele 34 de diagnostice preexistente din teste/Stripe rămân. O rulare intermediară a testului existent cu cinci intrări simultane a întâlnit eroarea 3 a tranzacției emulatorului; setul complet a trecut la rerulare, fără relaxarea aserțiunilor.
