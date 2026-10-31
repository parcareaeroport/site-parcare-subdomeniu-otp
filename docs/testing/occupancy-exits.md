# Teste pentru toate căile de ieșire din Ocupare (−1)

Rulare unică: `npm run test:occupancy:exits`.

Setul pornește un emulator Firestore izolat, cu proiecte `demo-*`, și un server HTTP exclusiv pe loopback. Raportul include `report.md`, `results.json`, `exits-matrix.json`, logurile și amprentele surselor. Nu încarcă datele sau cheile aplicației și nu contactează camere, Multipark, plăți ori email. Tokenurile sunt verificate criptografic printr-un substitut de test, iar anularea comercială este simulată; autorizarea pe roluri, endpointurile, serviciile LPR și tranzacțiile Firestore sunt cele reale.

## Inventarul proceselor de scădere

| Proces | Flux testat | Efect pe pagina Ocupare |
|---|---|---|
| Ieșire cameră cu rezervare | `POST /NotificationInfo/TollgateInfo` → serviciul LPR → `writeLprVisit` | −1 pentru șederea deschisă corectă |
| Ieșire cameră fără rezervare | Același flux, document `unmatched_lpr` | −1 și închiderea șederii fără rezervare |
| Ieșire manuală | `POST /api/admin/manual-lpr-exit` | −1 pentru șederea confirmată; celelalte rămân intacte |
| „Scoate din parcare” | Același dialog și endpoint de ieșire manuală | Aceleași protecții ca în Bookings și Intrări/Ieșiri |
| Ștergere cu absența confirmată | `POST /api/admin/bookings/delete`, pregătire + salvare | −1 numai dacă documentul era prezent; arhivă și audit atomic |
| Recuperare automată a ieșirii | `GET /api/cron/lpr-retry` | −1 când ieșirea salvată este aplicată, nu la fiecare retry |
| Retry cerut de ADMIN | `POST /api/admin/lpr-review`, apoi cron | Cererea de retry: 0; aplicarea ieșirii: −1 |

Au fost inspectate scrierile de prezență/contor din API-uri, serviciile și acțiunile Next.js și funcțiile Firebase. Schimbarea numărului închide referința vechiului număr, dar păstrează mașina în listă. Operațiile globale vechi de resetare/reverse sunt dezactivate și trebuie să răspundă 410, fără scrieri.

## Ce se verifică după fiecare pas

- Variația așteptată a numărului din `GET /api/admin/occupancy` și a listei de ID-uri: −1, 0 sau −2 pentru două mașini diferite.
- Dispare exact șederea selectată; celelalte mașini rămân prezente, cu `bookingId` și `visitId` corecte în `lpr_plate_state`.
- Calculul comun al contoarelor client corespunde API-ului; separat se verifică variația cache-ului `parkingLive`.
- În caz de refuz sau rollback, prezența, marcajele incrementării/scăderii și referințele șederilor rămân identice.
- Repetarea unei ieșiri sau ștergeri nu mai scade o dată. Contorul fixturelor nu devine negativ.
- Documentele contradictorii sunt fixtures deliberate. Pentru acestea se verifică blocarea și păstrarea stării, fără presupunerea că duplicatele ar fi două mașini reale.

## Cazuri acoperite

Matricea nouă trece prin endpointurile reale prin HTTP local. Include surse website/Expo/pay-on-site/manual și statusuri legacy eligibile; mașini fără rezervare; rezervări depășite, expirate sau anulate dar cu mașina încă prezentă; toate cele trei roluri permise la ieșirea manuală; lipsa orei intrării cu/fără confirmare; ștergerea prezenței confirmate și a unei rezervări deja ieșite/nefolosite; corectarea unei ieșiri istorice când aceeași mașină are o ședere mai nouă.

Testează și camera/manualul/ștergerea în concurență, două mașini diferite, rollback la scriere, răspuns pierdut și reluarea cererii, refuz/incertitudine Multipark, recuperare prin cron, reîncercare cerută de ADMIN, dialog învechit după reintrare, evenimente întârziate, duplicate, whitelist adăugat după intrare, date invalide/viitoare, autentificare lipsă și confirmări lipsă.

Rezultatul trebuie să fie 0 pentru anulare, expirare, corecție număr, heartbeat, simpla recepționare ANPR/Hikvision/Metrici și operațiile globale dezactivate. Workerul real `cancelNoShow` este executat direct în emulator: nu anulează o rezervare cu prezență observată și nu scade ocuparea când anulează o rezervare fără sosire.

Suitele existente adaugă verificările detaliate pentru validări, selecția unui singur document dintre duplicate, ordonarea la schimbarea orei, corectarea auditului, identitatea șederii, fidelitate/arhivă și integritatea tranzacțiilor. Matricea nouă este inclusă și în `npm run test:occupancy`.

## Limite importante

Pagina numără prezențele LPR efective, nu citește direct `parkingLive.occupiedCount`. Pentru date legacy fără incrementare deținută sau deja decrementate, ieșirea poate elimina un rând din pagină fără să mai scadă cache-ul. Recalcularea poate scădea cache-ul fără o nouă scădere în pagină. Aceste diferențe sunt declarate și verificate explicit; nu se repară automat istoricul.

Acest set verifică procesele aplicației din checkout. Nu acoperă intervenții directe în Firebase Console, integrarea completă WordPress/checkout sau scripturi externe, și nu demonstrează că o cameră citește fiecare plecare fizică ori că un operator confirmă corect absența. Publicarea și verificarea cu mașini reale rămân separate. Nicio operație de test nu modifică producția.

## Rezultat local — 30.10.2026

`npm run test:occupancy:exits`: **10/10 suite trecute**. Matricea nouă: **35 scenarii și 130 de pași cu variația ocupării verificată**, dintre care 28 cu scădere și 66 cu variație zero; restul sunt intrările/reintrările necesare pregătirii fluxurilor. Setul include suplimentar cele 45 de verificări HTTP ale registrului existent și regresiile ieșirilor/asocierii/arhivării. TypeScript nu introduce diagnostice noi față de cele 34 preexistente din teste/Stripe. Nicio modificare în datele de producție, nicio publicare.
