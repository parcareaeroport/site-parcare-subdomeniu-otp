# Ieșiri LPR și evenimente istorice fără eventTime

Caz reprodus: NT34SMR are intrarea asociată din 27 octombrie 2026 și două
receipts duplicate. Documentele vechi au accurateTime, dar nu eventTime.
Verificarea ieșirii interpreta lipsa câmpului nou drept ordine necunoscută și
refuza salvarea cu EXIT_REQUIRES_REVIEW, deși nu exista o intrare ulterioară.

receiptLprTime recunoaște acum formatul civil România din accurateTime/snapTime
numai pentru evenimente istorice deja asociate (matched, duplicate, unmatched_visit)
cu matchedBookingId. Nu aplică decalajul actual al camerelor la istoric.
Datele originale nu sunt rescrise. eventTime existent are prioritate, chiar invalid.
Receipts neasociate, în așteptare, cu mod instant, corecție explicită sau date invalide
nu primesc acest fallback. Verificările pentru ore ambigue, intrare ulterioară,
ședere schimbată, duplicate și idempotentă rămân active.

Aceeași interpretare este folosită la recunoașterea unei ieșiri istorice ulterioare,
pentru a nu redeschide o ședere deja închisă când sosește târziu o intrare veche.
Mesajele manuale disting ordinea necunoscută de intrarea ulterioară și de starea contradictorie.

Verificare: cazul sintetic cu intrare veche/duplicate eșuează înaintea corecției;
11 scenarii noi verifică formatul vechi, intrarea ulterioară pe camere și manual,
date/configurații neeligibile, protejând contorul. Pe datele reale NT34SMR s-a
executat numai verificarea în memorie, fără scrieri; rezultatul nu mai blochează
ieșirea din cauza intrării vechi. Salvarea efectivă rămâne a operatorului.

Rezultat: toate cele 8 suite emulator au trecut (224 scenarii); suita ieșirilor
repetată pe forma finală a codului: 50 scenarii trecute. Testele corecției orei și
loggerului au trecut. TypeScript produce exact diagnosticele anterioare, fără erori noi.
