# Ieșirea după corectarea manuală veche a intrării

## Caz verificat doar prin citire în Firebase

CT30WWK, rezervarea `z4DmAbysAR7V8xBqlc4s`: șederea `WTS1BWMIxWLxoL2PxN8w` are observația camerei la 29.10.2026 12:05:37.707, iar vechiul editor manual a înlocuit intrarea și ultima observație din rezervare cu 11:12. Referința pe număr a păstrat ora camerei. Trei ieșiri de cameră din 03.11 au fost refuzate cu `inconsistent_visit_state`; dialogul manual folosește aceeași verificare.

## Corecție locală

Verificarea comună permite închiderea acestei șederi dacă istoricul dovedește strict:

- rezervarea și referința sunt prezente și au același bookingId și visitId;
- formatul este cel vechi, fără lastEventId, cu manualOverride și dispozitiv manual_admin;
- observația camerei asociată aceluiași visitId coincide cu ora referinței;
- evenimentul manual coincide cu intrarea corectată și cu timestampul manualOverrideAt;
- corecția a fost înregistrată după actualizarea referinței.

Ieșirea trebuie să fie după ambele ore. Toate celelalte validări, versiunea contextului și tranzacțiile rămân active. Nu se acceptă o altă ședere, pointer închis, proveniență necunoscută sau contradicție modernă. Auditul ieșirii păstrează `legacyArrivalReconciliation`, iar evenimentele originale rămân intacte.

Corectarea modernă a intrării folosește deja `correctLprArrival`: modifică numai arrivedAt și auditul corecției, păstrând ultima observație și referința. Nu produce această divergență veche.

Formula paginii Ocupare și regulile contorului nu sunt modificate. Ieșirea validă folosește tranziția comună, cu decrement unic și protecția la repetare.

## Verificare

Scenarii adăugate în `test-lpr-legacy-manual-exit-emulator.cjs`: admin/employee/entriesOperator, cameră, repetare, concurență, reintrare, context schimbat, rollback, lipsă dovezi și referințe contradictorii. Timpul aplicației din această suită este fixat pentru a nu transforma retrospectiv fixture-urile în evenimente prea vechi.

Nu s-au modificat date de producție și nu s-a publicat. După publicare, operatorul reîncarcă dialogul și introduce plecarea reală. Evenimentele vechi deja trimise la verificare nu sunt reaplicate automat de această schimbare.

## Rezultate finale

- `npm run test:occupancy`: **21/21 suite PASS**, cod 0. Suita compatibilității vechi are 36 scenarii, dintre care 15 adăugate pentru acest caz.
- Raport: `/var/folders/57/w83hfs491_b5k_d4sw7tq1jh0000gq/T/parking-occupancy-acceptance-6xXFWQ/report.md`.
- Reproducere offline cu copia citită din Firebase: verificarea veche returnează `inconsistent_visit_state`; cea nouă returnează `null`, cu dovada reconcilierii aceleiași șederi.
- `git diff --check`: PASS. TypeScript păstrează cele 34 diagnostice preexistente din testele Jest și Stripe; niciun diagnostic în fișierele sursă modificate.
- Prima rulare a expus dependența de data reală a unui fixture vechi și o eroare tranzitorie a emulatorului (`Transaction is invalid or closed`). După fixarea ceasului fixture-ului, întreaga comandă a trecut; validările de producție nu au fost relaxate pentru test.
