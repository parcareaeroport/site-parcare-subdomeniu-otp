# Intrări întârziate și corectarea numerelor istorice

Modificări locale peste `2bc07ea`. Nu s-au publicat modificări și nu s-au accesat date de producție.

## Comportament reparat

1. **Ieșirea ajunge înaintea intrării.** O ieșire validă deja primită, trimisă la verificare sau verificată, împiedică o intrare anterioară să redeschidă automat șederea. Regula se aplică și reluării unei intrări după eșecuri de procesare. Ambele dovezi rămân disponibile; noua alertă explică motivul. Nu se inventează o asociere cu o rezervare sau o ieșire fizică. Cazul necesită verificare ADMIN.
2. **Corectarea numărului unei șederi vechi.** Se păstrează atomic pe numărul vechi o limită cronologică și legătura cu documentul/șederea corectată, inclusiv când referința veche lipsea. Citirile vechi nu mai creează o a doua prezență. Ora corectării este separată de orele reale de intrare/ieșire; acestea nu sunt fabricate sau înlocuite.

O ieșire încă `pending` continuă să fie procesată automat după intrarea anterioară. O sosire legitimă după ultima ieșire rămâne permisă. Numărul vechi poate fi reutilizat după limita corectării; nu este adăugat într-o listă permanentă de excludere. Limita are precizie la secundă, astfel încât milisecundele camerelor din aceeași secundă nu pot ocoli protecția.

Evenimentele cu ceas invalid, viitor sau prea vechi, respinse la recepție, nu sunt tratate ulterior ca dovezi valide doar pentru că timpul a trecut. Verificarea recepțiilor și scrierile șederii rămân în tranzacție. Nu s-au schimbat formula Ocupării, contractul Expo, regulile comerciale, whitelist sau datele istorice.

Noile explicații din Ocupare:

- „Există deja o ieșire ulterioară. Intrarea veche nu a redeschis șederea; verifică succesiunea.”
- „Citire întârziată pentru un număr corectat. Nu s-a creat o prezență suplimentară; verifică șederea.”

## Verificări

Testele au folosit Firestore Emulator local, proiectele sintetice `demo-parking-ordering`, `demo-parking-integrity` și `demo-parking-lpr`. Suitele care șterg același proiect au rulat secvențial. Nu s-au folosit credențiale ori documente de producție.

| Suită | Rezultat |
| --- | --- |
| Regresii noi pentru ordine și corectări | 18 scenarii |
| Integritate LPR existentă | 36 scenarii |
| Asociere camere | 24 scenarii |
| Ieșire manuală | 27 scenarii |
| Intrare manuală | 33 scenarii |
| Ocupare comună | 7 scenarii |
| Forecast | 27 teste |
| Afișare LPR | 22 verificări |
| Verificare ADMIN | 10 verificări |

**145 de scenarii cu emulatorul**, plus verificările pure de mai sus. Testul pentru livrare inversată a fost executat și înainte de reparare: a eșuat cu `1 !== 0`, reproducând problema.

Noile regresii includ livrare inversată, 10 eșecuri și reluare de către admin, ieșire deja verificată, intrare nouă legitimă, recuperarea automată a recepțiilor `pending`, ceasuri invalide/viitoare, vehicul fără rezervare, livrări concurente, referință istorică absentă, ore istorice lipsă, citiri între intrare și corectare, limita la secundă/milisecundă, reutilizarea legitimă a numărului, corectare concurentă și ieșire manuală după corectare. În fiecare scenariu nou se verifică și pagina/API-ul de Ocupare și contorul fixture-ului, nu doar rezultatul funcției.

Browser: paginile reale Ocupare, Bookings și Intrări/Ieșiri, la 1440 și 390 px, inclusiv browser cu alt fus orar. Noile scenarii trec prin endpointul real Tollgate și verifică numărătoarea și textele din pagină. Corectarea pe mobil pornește de la o ședere fără referință veche. Sunt verificate și confirmările, conflictele la salvare, rolurile operatorului, actualizarea automată, erorile temporare și revenirea după timeout. Capturile desktop/mobil au fost inspectate. Fără erori runtime sau cereri către Firebase de producție.

Harnessul browser folosește autentificare sintetică și fixture-uri pentru serviciile externe; cardul contorului/forecastului este simplificat în harness, dar lista și răspunsul API real de Ocupare sunt verificate. Nu reprezintă validarea camerelor fizice, a autentificării publicate ori a serviciilor de plată.

TypeScript: aceleași **34 de diagnostice preexistente** înainte și după modificare, fără diagnostice noi. Verificarea globală nu este prezentată ca verde. Paginile și endpointurile folosite au fost compilate de harnessul Next.

Loguri: `/tmp/parking-two-fixes-{regressions,integrity,association,exit,entry,unified,browser,forecast,display,admin-review}.log`. Comparație TypeScript: `/tmp/parking-two-fixes-tsc-comparison.json`. Capturi: `/tmp/parking-two-fixes-attention-390.png`, `/tmp/parking-two-fixes-attention-1440.png`.

## Limite și publicare

Nu se corectează retroactiv documentele deja greșite. Cazurile ambigue rămân pentru verificare fizică; marcarea unei alerte ca verificată nu închide implicit o ședere. Evenimentele ratate complet de camere și confirmările manuale greșite rămân posibile.

Nu apar colecții noi sau interogări noi: se folosesc recepțiile pe număr și documentele de ședere deja citite. `plateCorrection` este metadată nouă în referința existentă `lpr_plate_state`; nu necesită index nou. Configurația camerelor, retransmiterea reală și versiunea publicată trebuie verificate separat la lansare. Nu s-a făcut publicare în acest lot.
