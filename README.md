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

## CLI sperimentale: `evo`

La CLI organizza gli esperimenti in **sessioni**. Dopo `npm link` (oppure
`bun link`) dalla root del progetto, `evo` e' disponibile nella shell. Senza
link, gli stessi comandi si eseguono come `npm run cli -- <comando>`.

```bash
evo help
evo list
evo show discovery-<id>
```

### `evo new`: benchmark del curriculum

```bash
evo new
DISCOVERY_MAX_STEPS=30 DISCOVERY_CODE_ATTEMPTS=3 evo new baseline-30
```

`evo new` crea una sessione `discovery-<timestamp>` ed esegue una volta i sette
scenari fissi: consegna semplice, porta/chiave, variante speculare, doppia
consegna, due pacchi, batteria e detour. E' il benchmark riproducibile: per
ogni episodio registra esplorazione, capability JSON, codice candidato e
validazione.

### `evo evolve`: generalizzazione su varianti

```bash
evo evolve --generations 10 --seed 42
```

La prima famiglia disponibile e' `battery-return`. Ogni generazione crea una
variante deterministica diversa dal seed (direzione, distanze, batteria e
budget energetico). Prima di chiedere al modello, il runtime tenta le
capability in codice gia' promosse: una capability valida risolve direttamente
la variante senza una nuova richiesta LLM. Se nessuna si applica, l'agente
esplora e sintetizza codice soltanto dopo una traccia riuscita, poi lo testa su
tre seed hold-out mai visti. Il codice viene promosso soltanto se supera
training e tutti gli hold-out. L'output e' una sessione
`evolve-battery-return-<timestamp>`.

### Sessioni, ripresa e rimozione

```bash
evo show <run-id>
evo resume discovery-<id>
evo delete <run-id>          # anteprima
evo delete <run-id> --yes    # conferma la rimozione
```

`resume` completa esclusivamente una discovery interrotta e conserva i budget
registrati nel checkpoint. Le evoluzioni sono immutabili in questa prima
versione: per una nuova generazione si usa un nuovo `evo evolve`.

### Metriche e token

`evo list` riporta successo, score e codice validato. `evo show` indica anche
quando una generazione e' stata risolta riusando codice esistente. Le colonne `IN`, `OUT` e
`REASON` indicano rispettivamente token di input, output finale e ragionamento.
I report precedenti all'introduzione della telemetria mostrano `n/a`. I token
di una sessione ripresa sono marcati come parziali, poiche' coprono solo il
processo di ripresa.

Le richieste del loop sperimentale sono isolate: ogni decisione riceve un
manifest, l'osservazione corrente e un registro compatto delle evidenze, senza
trascinare l'intera conversazione OpenCode. Questo mantiene il costo per
iterazione controllato; `OPENCODE_DEBUG_PROMPTS=1` resta disponibile per
ispezionare prompt e risposte in console.

## Workspace evolvibile dell'agente

Il piano JSON non e' l'unico artefatto evolutivo. Il codice operativo e'
diviso in moduli ispezionabili in `src/agent-workspace/`:

- `navigation`: A* e il contratto di attraversabilita' fornito dall'ambiente;
- `memory`: heatmap e trace locali all'episodio;
- `task-selection`: ranking di task e reward;
- `coordination`: contratto iniziale per intenzioni e riserve multi-agente;
- `diagnostics`: rende leggibili eventi e benchmark falliti; non prescrive modifiche al modello.

Esegui il benchmark iniziale con:

```bash
npm run benchmark:workspace
```

Per misurare generalizzazione, esegui anche le famiglie deterministiche: i seed
di training sono disponibili al ciclo evolutivo, mentre quelli holdout restano
separati. La fitness riporta copertura, score medio e minimo, passi delle sole
esecuzioni riuscite, azioni bloccate e attese: un fallimento veloce non viene
mai premiato come efficienza.

```bash
npm run benchmark:families
```

Il runner salva un report in `reports/workspace-benchmark-*.json`. Una futura
iterazione di codice deve dichiarare il collo di bottiglia osservato, i moduli
da modificare, la metrica attesa e i benchmark di regressione; una modifica e'
promossa solo se passa training e holdout. Il contratto per un coding agent e'
in [`agent-workspace/AGENTS.md`](agent-workspace/AGENTS.md).

### Ciclo candidato → benchmark → promozione

Il primo confine mutabile e' una **policy extension**: vero codice JavaScript
che puo' sostituire una singola decisione, ma riceve soltanto un'osservazione
serializzabile, la scelta baseline e la memoria dell'episodio. Non riceve
filesystem, rete o un handle del gioco; il simulatore resta l'unico esecutore
delle azioni. Questo consente di far generare al modello euristiche di
precondizione, heatmap, esplorazione, pianificazione dell'energia e, in
seguito, coordinamento, mantenendo il cambiamento verificabile.

Una proposta ha i campi `id`, `bottleneck`, `module`, `rationale`,
`expectedMetric` e `source`, dove `source` e' una sola funzione JavaScript.
Per provarla senza alterare l'agente base:

```bash
npm run evaluate:workspace-candidate -- proposta.json
```

Il valutatore compila il candidato in un VM minimale, confronta baseline e
candidato su scenari fissi e famiglie generate, divise in training e holdout,
e salva obiettivi aggregati. Una proposta e' **promotable** solo se migliora
fitness di training (copertura, score, robustezza o efficienza), non peggiora
nessun training e non perde un successo precedente negli holdout.
Il passo successivo collega a questo formato un coding-agent OpenCode con tool
dichiarati per leggere contratti, trace e benchmark, senza dargli scrittura
diretta sui moduli promossi.

Quel ciclo e' disponibile con una singola iterazione controllata:

```bash
npm run evolve:workspace:opencode
```

### Revisioni modulari TypeScript

Per evolvere oltre una singola decisione, il modello può inventare una nuova
**capability** e proporre una revisione TypeScript completa. Non esiste una
lista host di moduli cognitivi: il manifest espone soltanto una superficie di
file modificabili. La revisione viene applicata esclusivamente a una copia temporanea di
`src/`, valutata contro baseline, famiglie training e holdout, quindi eliminata.
Il workspace reale non viene modificato né promosso dal modello.
Ogni proposta, anche se respinta, viene salvata immutabilmente in
`agent-workspace/capability-archive/` e fornita come lavoro precedente ai cicli
successivi: il modello può riparare, combinare o riusare idee già esplorate.

```bash
MODULE_PATCH_MODELS=meta/llama-3.3-70b,qwen/qwen3.8-27b \
MODULE_PATCH_ATTEMPTS=2 \
npm run evolve:module-workspace
```

Per ispezionare una proposta JSON già disponibile senza chiamare un modello:

```bash
npm run evaluate:module-patch -- proposta-modulo.json
```

Seleziona soltanto l'episodio con la metrica peggiore, invia a OpenCode/LM Studio
osservazioni, azioni, esiti e contratto di esecuzione, poi persiste proposta,
valutazione e token in `reports/workspace-evolve-*.json`. Non classifica il
problema e non suggerisce un modulo o un algoritmo: questa decisione appartiene
al modello. Se tutti i benchmark riescono, registra un run `no-change` senza
invocare il modello. Per ora un candidato
`PROMOTABLE` resta un artefatto da ispezionare: la promozione nell'agente
runtime sara' un comando separato e tracciabile, non un side effect del modello.

Dopo aver ispezionato un report promuovi esplicitamente il candidato:

```bash
npm run promote:workspace-candidate -- reports/workspace-evolve-<id>.json
```

La proposta viene conservata immutabilmente in `agent-workspace/promoted/history/`
ed entra in testa all'insieme ordinato `agent-workspace/promoted/active.json`: una
nuova promozione ha precedenza, mentre i layer precedenti restano fallback e non
vengono cancellati. Il successivo
`npm run benchmark:workspace` carica solo questa policy promossa e ne mostra
l'identificatore; un modello non ha alcun percorso diretto per eseguire la
promozione.

Quando la suite e' satura, il meta-loop puo' cercare autonomamente una nuova
challenge, senza indicare all'agente come risolverla:

```bash
npm run discover:challenge:opencode
```

Per confrontare esplicitamente i modelli locali, l'ordine e il numero di tentativi
sono configurabili. Ogni tentativo conserva nel report modello, uso token, modalità
di decoding (`json_schema` oppure fallback `json_object`) e testo grezzo della
risposta; non viene fermato da un successo precedente.

```bash
CHALLENGE_ATTEMPTS=2 \
CHALLENGE_MODELS=meta/llama-3.3-70b,qwen/qwen3.8-27b \
npm run discover:challenge:opencode
```

Un candidato entra in `scenarios/generated/` soltanto se il suo witness interno
raggiunge score positivo e l'agente promosso non lo risolve. Il witness serve
esclusivamente a escludere challenge impossibili; non viene incluso nel contesto
del successivo coding agent.

### Requisiti oltre gli scenari correnti

Il backlog esplicito in [`requirements.v1.json`](agent-workspace/requirements.v1.json)
separa un requisito ingegneristico da una mappa che lo rende misurabile. Le prime
due capacita' sono validate; heatmap/frontier, replanning dinamico, coordinamento
multi-agente e una euristica di navigazione appresa non vengono ancora richiesti
al modello perché manca il rispettivo benchmark. Questo evita che un LLM produca
codice “creativo” senza segnale sperimentale. Il prossimo incremento concreto è
`partial-observation-frontier`: renderà necessario il modulo `exploration` e
permetterà di confrontare heatmap e strategie alternative su seed holdout.

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
