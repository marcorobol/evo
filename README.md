# Evolving Deliveroo Agent

Baseline sperimentale per un agente BDI su Deliveroo.js. Il controllo del
gioco e la persistenza dei trace sono deterministici; il modulo LLM verra'
aggiunto come generatore di proposte strutturate e validate, non come esecutore
di codice.

Il percorso sperimentale principale e' ora l'ambiente locale turn-based:
`TurnBasedEnvironment.step(action)` avanza esattamente di un turno. Non ha
timer, rendering o socket, cosi' il validatore puo' scegliere quando far
progredire un episodio. L'adapter Deliveroo.js resta disponibile per confronti
con il gioco originale.

## Avvio

1. Esegui `npm install`, poi `npm run start` per la demo locale a turni.
2. Per l'integrazione opzionale con il gioco originale, avvia Deliveroo.js,
   copia `.env.example` in `.env` e usa `npm run start:deliveroo`.

Ogni azione viene registrata in `traces/` come JSONL. La policy iniziale cerca
parcel visibili, li raccoglie, calcola un percorso sulla mappa conosciuta e li
porta alla tile di consegna.

La demo locale e il validatore non usano un LLM e non richiedono una chiave API.
Una chiave e' necessaria solo dopo aver configurato un provider cloud per
`CapabilityProposer`; potra' anche essere sostituita da un modello locale.

## Prima generazione LLM

1. Copia `.env.example` in `.env`.
2. Per LM Studio imposta `LLM_PROVIDER=lmstudio`, `LLM_MODEL` e, se necessario,
   `LLM_BASE_URL`. Avvia il Local Server in LM Studio e carica il modello scelto.
   Non serve una chiave.
   Per i provider cloud imposta anche la relativa chiave, senza inserirla mai
   in uno scenario o nel codice.
3. Esegui `npm run generate:capability`.

Il generatore stampa una proposta JSON e il suo risultato di validazione. Una
proposta non valida termina con codice `2` e non modifica l'episodio originale.
Le proposte valide entrano in `capabilities/library.json`, con le metriche di
fitness necessarie per selezione e riuso.

Per generare una capability procedurale, esegui:

```bash
npm run generate:code-capability
```

La procedura e' una funzione JavaScript compatibile con TypeScript che restituisce
un piano a partire dalle credenze. Viene controllata sintatticamente, eseguita in
un contesto VM minimale e poi validata nell'ambiente turn-based. Questo isolamento
e' sperimentale e non e' una frontiera di sicurezza per codice ostile.

Per selezionare e riusare la capability piu' pertinente nello scenario corrente:

```bash
npm run reuse:capability
```

Il riuso e' sempre rivalidato; solo un'esecuzione valida incrementa il contatore
`uses` nell'archivio.

## Curriculum sperimentale

Gli scenari versionati includono consegna diretta, double-delivery, chiave/porta,
batteria, due pacchi e detour attorno a un muro. Esegui:

```bash
npm run run:curriculum
```

Il report espone copertura del riuso, fitness media e risultati per scenario.

Per eseguire il ciclo evolutivo, che riusa prima e genera una capability JSON
solo quando necessario, esegui:

```bash
npm run evolve:curriculum
```

Imposta `MAX_REPAIR_ATTEMPTS` in `.env` per controllare quante correzioni
guidate dal validatore vengono richieste per ogni episodio.

## Generalizzazione JSON → codice

Una capability JSON validata puo' essere trasformata in una piccola funzione
procedurale e deve superare sia lo scenario sorgente sia la sua variante
speculare prima di entrare nella libreria:

```bash
npm run generalize:capability
```

Per collegarsi a un server LM Studio su una macchina della LAN, imposta
`LLM_BASE_URL=http://<indirizzo-ip>:1234/v1`. Se in LM Studio e' attivo
**Require Authentication**, salva il token in `LMSTUDIO_API_KEY` nel file
`.env` (che non e' versionato).

## Struttura

- `src/belief-store.ts`: normalizzazione e stato delle percezioni.
- `src/deliveroo-gateway.ts`: unico adapter verso la SDK del gioco.
- `src/baseline-policy.ts`: baseline senza LLM.
- `src/trace-store.ts`: trace riproducibili per selezione e valutazione.
- `src/turn-based-environment.ts`: simulatore locale deterministico, con
  energia, batterie, chiavi, porte e double-delivery.
- `src/scenario-loader.ts`: schema Zod e loader per scenari JSON versionati.
- `src/capability-validator.ts`: esecuzione sandbox e fitness trasparente delle
  capability candidate.
- `src/capability-library.ts`: archivio persistente e selezione delle capability
  validate.
- `src/code-capability.ts`: esecuzione controllata delle capability procedurali.
- `src/environment-contract.ts` e `src/generic-capability.ts`: core agnostico
  rispetto al dominio; conosce soltanto manifest, osservazioni, azioni e outcome.
- `src/turn-based-adapter.ts`: adapter che incapsula tutte le regole Deliveroo.

La prima esecuzione end-to-end del core agnostico, usando l'adapter turn-based
solo come ambiente, e' disponibile con `npm run evolve:generic`.

`opencode.jsonc` vincola l'eventuale host OpenCode embedded a
`lmstudio/qwen/qwen3.8-27b`. Il token resta esclusivamente in `.env` tramite
`LMSTUDIO_API_KEY`.

Gli scenari sono in `scenarios/`; `key-door-delivery.v1.json` e' il primo caso
versionato. Il validatore esegue il piano proposto su una copia dell'episodio:
la selezione di una capability non modifica mai lo stato reale dell'esperimento.

## Prossimo incremento

`src/capability-proposer.ts` espone gia' un contratto AI SDK/Zod per le
capability candidate. Per usarlo manca solo la scelta e configurazione del
provider del modello. L'agente potra' proporre piani nuovi, ma il runtime li
accettera' soltanto dopo validazione, esecuzione controllata e valutazione
quantitativa.
