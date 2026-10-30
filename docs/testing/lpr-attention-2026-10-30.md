# Cazuri recente LPR, grupate pe număr auto

În Ocupare, lista principală arată numere distincte cu mesaje nerezolvate primite
în ultimele 24 de ore. Data primirii pe server determină vechimea, nu ora camerei.
Mesajele aceluiași număr normalizat sunt grupate; nu asociem automat citiri similare
(ex. F80RPG și IF80RPG). În fiecare grup rămâne verificarea individuală a mesajelor.

Istoricul păstrează separat mesajele vechi, cu primire necunoscută sau acoperite de
starea aplicată ulterior a șederii. Aceasta este o clasificare vizuală, nu confirmă
prezența fizică și nu schimbă starea unui eveniment. O ieșire manuală anterioară
unui nou mesaj de cameră nu îl ascunde automat. Stările contradictorii/future și
orele neinterpretabile nu sunt folosite pentru a declara un caz acoperit.

Sunt 20 numere pe pagină, fără trunchiere la primele 50 mesaje. Fiecare mesaj arată
separat ora primirii în Europe/Bucharest și ora evenimentului în convenția LPR
existentă. Este eliminată afirmația necondiționată că reîncercările funcționează.

API-ul păstrează occupiedCount/plates și adaugă groups/history/eventCount/totalCount;
count reprezintă acum numerele recente distincte. events păstrează mesajele recente
în formă plată. Rezervările, evenimentele și ocuparea nu sunt modificate.
Citirea stărilor se face prin getAll în loturi de 100 pentru numere recente; nu
există o interogare per mesaj, iar un index nou Firestore nu este necesar.

Verificări:
- 12 scenarii pentru grupare, ordine, limite 24h, ceas eronat, istoric, actualizări
  ulterioare, stări contradictorii și lipsa trunchierii.
- 28 scenarii asociere/emulator, incluzând 2 verificări noi ale endpointului Ocupare;
  36 integritate ocupare; 7 ocupare unificată (71 scenarii emulator).
- Componenta reală verificată în Safari cu date fictive și autentificare/API simulate:
  grup extins cu mesaje distincte, dialog individual, pagina 2, istoric separat,
  spațiu de 390px și afișarea orei României.
- TypeScript: fără diagnostice noi față de rezultatul anterior.
