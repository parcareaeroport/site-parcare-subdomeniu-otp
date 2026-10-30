# Corecția orei camerelor LPR

Corecție per dispozitiv în `LPR_CAMERA_CLOCK_OFFSETS_SECONDS_JSON` (JSON obiect,
secunde întregi, interval -86400…86400). Pozitiv = camera este înainte și scădem
valoarea; negativ = camera este în urmă. Lipsa variabilei sau a dispozitivului = 0.
Configurația invalidă trimite evenimentul la verificare (`invalid_clock_offset_config`).
Nu se schimbă autentificarea sau regulile de asociere/ocupare.

Exemplu de configurare, bazat pe mesajele observate în dimineața de 30 octombrie:

```json
{"intrare_1":3149,"iesire_1":3206}
```

Aceste valori sunt estimări din diferența dintre ora mesajului și primirea pe server,
rotunjite în sus la secundă. Transportul introduce întârziere: ele nu reprezintă o
calibrare exactă a ceasurilor. Înainte de activarea în producție trebuie verificate
pe mai multe mesaje recente, separat pentru fiecare cameră. Dacă ora camerei a fost
între timp reparată, corecția trebuie eliminată (0). Nu se aplică automat aceste
valori în cod și nu se modifică variabilele Vercel prin această implementare.

Pentru ceas civil România, scăderea precede rezolvarea fusului și a schimbării orei.
Pentru timestampuri cu mod `instant`, se corectează instantul real și apoi ora civilă.
Orele ambigue/inexistente, viitoare după corecție sau prea vechi rămân blocate.
Nu folosim ora primirii ca înlocuitor al orei evenimentului.

`accurateTime`, `snapTime` și payloadul existent rămân originale. În receipt se
păstrează și `originalEventTime`, `originalEventInstant`, `clockOffsetSeconds`;
`eventTime`/`eventInstant` sunt cele corectate, folosite de asociere, auditul șederii
și ordonare. Logul `camera_validated` arată ambele ore, corecția și diferența rămasă.
Identitatea evenimentului rămâne bazată pe datele originale: retransmiterea după
schimbarea configurării nu creează încă o intrare și nu rescrie receiptul existent.
Retry folosește ora deja salvată, fără a reaplica decalajul.

Evenimentele istorice blocate nu se reprocesază automat. Reconcilierea lor este
separată și trebuie să țină cont de intrările/ieșirile deja făcute manual.

## Verificare locală

- `node scripts/test-lpr-clock-offset.cjs`: configurare, cele două camere, date
  originale, mesaj vechi, schimbarea zilei, ambele moduri, DST, date/config invalide.
- `scripts/test-lpr-association-emulator.cjs`: scenarii noi pentru intrare/ieșire
  corectate, asociere, ocupare, duplicate inclusiv după schimbarea configurației,
  audit original, oră încă în viitor și configurație invalidă.
- Regresiile LPR și manuale se rulează numai cu emulatorul și proiectele demo.

După configurare și publicare, verificăm o intrare și o ieșire reale: ora corectată,
rezervarea asociată, prezența și variația contorului. Un HTTP 200 singur nu este dovadă.

Rezultat local 30 octombrie: toate cele 8 suite emulator au trecut (213 scenarii),
plus testele corecției, cele 11 scenarii de compatibilitate HTTP și suita loggerului.
`tsc --noEmit` produce aceleași diagnostice ca înaintea corecției (diff identic);
nu au apărut erori TypeScript noi. `git diff --check` a trecut.
