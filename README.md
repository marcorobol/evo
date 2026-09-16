# Evolving Deliveroo Agent

Baseline sperimentale per un agente evolutivo su Deliveroo.js. Il controllo del
gioco e la persistenza dei trace sono deterministici; il modulo LLM genera
proposte strutturate e codice di capability, ma non esegue mai direttamente
azioni nell'ambiente.

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
I comandi di esplorazione o evoluzione LLM usano invece il gateway UniTn LiteLLM
configurato in `.env`.

## Configurazione

Copia `.env.example` in `.env` e inserisci soltanto `OPENAI_API_KEY`. Il file
`.env` e' ignorato da Git. Tutti i comandi eseguibili caricano `.env`, incluso
`npm run start:deliveroo`; le variabili gia' esportate dalla shell mantengono
precedenza.

Configurazione minima per il gateway UniTn:

```dotenv
OPENAI_BASE_URL=https://llm.bears.disi.unitn.it
OPENAI_API_KEY=<la-tua-chiave>
OPENAI_MODEL=qwen3.8-27b
OPENCODE_PROVIDER=unitn-litellm
```

Il suffisso `/v1` e' aggiunto automaticamente per le chiamate dirette. Il file
[`opencode.jsonc`](opencode.jsonc) usa invece l'endpoint completo per il server
OpenCode embedded. Al momento della verifica, `qwen3.8-27b` ha risposto sia
alle chiamate JSON strutturate sia al probe OpenCode. Gli ID disponibili dal
gateway includono anche `llama-3.3-70b`, `qwen3-coder-next` e `gpt-4o`.

| Gruppo | Variabili | Default |
| --- | --- | --- |
| Modello | `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL` | gateway UniTn, chiave vuota, `qwen3.8-27b` |
| OpenCode | `OPENCODE_PROVIDER`, `OPENCODE_PLANNER_TIMEOUT_MS`, `OPENCODE_HEARTBEAT_MS`, `OPENCODE_DEBUG_PROMPTS` | `unitn-litellm`, `180000`, `5000`, `0` |
| Gioco live | `DELIVEROO_URL`, `DELIVEROO_NAME`, `DELIVEROO_TOKEN`, `DELIVEROO_STEP_SETTLE_MS`, `LIVE_ACTION_INTERVAL_MS`, `LIVE_MAX_STEPS`, `DELIVEROO_READY_TIMEOUT_MS` | vedi `.env.example` |
| Capability | `CAPABILITY_GOAL`, `MAX_REPAIR_ATTEMPTS`, `SOURCE_CAPABILITY`, `CAPABILITY_ARTIFACT_MODEL` | scenario di consegna, `2`, capability chiave-porta, modello principale |
| Discovery | `DISCOVERY_MAX_STEPS`, `DISCOVERY_CODE_ATTEMPTS`, `DISCOVERY_RUN_ID`, `DISCOVERY_RESUME` | `20`, `3`, ID timestamp, `0` |
| Varianti | `EVOLVE_GENERATIONS`, `EVOLVE_SEED`, `EVOLVE_MAX_STEPS`, `EVOLVE_CODE_ATTEMPTS`, `EVOLVE_RUN_ID` | `10`, `1`, `20`, `3`, ID timestamp |
| Workspace | `WORKSPACE_CODE_ATTEMPTS`, `WORKSPACE_EVOLVE_RUN_ID` | `2`, ID timestamp |
| Patch modulari | `MODULE_PATCH_ATTEMPTS`, `MODULE_PATCH_MODELS`, `MODULE_PATCH_RUN_ID`, `EVOLUTION_FROM_SCRATCH` | `2`, Llama poi Qwen, ID timestamp, `0` |
| Challenge | `CHALLENGE_ATTEMPTS`, `CHALLENGE_MODELS`, `CHALLENGE_RUN_ID` | `2`, Llama poi Qwen, ID timestamp |

`NODE_ENV=test` e' riservata ai test e impedisce al solo runner
`evolve:workspace:opencode` di caricare `.env`.

## Riferimento comandi

| Obiettivo | Comando consigliato | Stato |
| --- | --- | --- |
| Verificare il substrate | `npm test`, `npm run build` | Corrente |
| Eseguire demo locale | `npm run start` | Corrente |
| Eseguire benchmark | `evo benchmark all` | Corrente |
| Generare capability diretta | `evo artifact [--model ID]` | Corrente |
| Evolvere patch TypeScript | `evo module [--attempts N] [--models ID,ID] [--from-scratch]` | Corrente sperimentale |
| Cercare nuove challenge | `evo challenge [--attempts N] [--models ID,ID]` | Corrente sperimentale |
| Consultare i report | `evo list`, `evo show <run-id>` | Corrente |
| Gioco Deliveroo.js live | `npm run start:deliveroo`, `npm run play:live:evolving`, `npm run explore:live:opencode` | Integrazione/demo |
| Verificare LiteLLM/OpenCode | `npm run probe:opencode:qwen`, `npm run reproduce:opencode:plan` | Diagnostica |

Gli script npm rimangono disponibili sia per automazione sia per riprodurre
esperimenti. I flussi moderni sono:

| Script npm | Equivalente CLI | Stato |
| --- | --- | --- |
| `benchmark:workspace`, `benchmark:families` | `evo benchmark workspace`, `evo benchmark families` | Corrente |
| `evolve:artifact` | `evo artifact` | Corrente |
| `evolve:module-workspace`, `evaluate:module-patch` | `evo module`; valutazione manuale con script | Corrente sperimentale |
| `discover:challenge:opencode` | `evo challenge` | Corrente sperimentale |
| `start`, `start:deliveroo`, `play:live:evolving`, `explore:live:opencode` | — | Demo/integration |
| `probe:opencode`, `probe:opencode:qwen`, `reproduce:opencode:plan` | — | Diagnostica |

I seguenti script sono **deprecati**: restano eseguibili per riproducibilita',
ma non devono essere la base di nuovi esperimenti.

| Script npm deprecati | Sostituzione |
| --- | --- |
| `generate:capability`, `generate:code-capability`, `generalize:capability`, `reuse:capability` | `evo artifact` |
| `run:curriculum`, `evolve:curriculum` | `evo benchmark all` + `evo artifact` |
| `evolve:generic`, `evolve:generic-curriculum`, `evolve:generic:opencode`, `explore:generic:opencode`, `synthesize:generic:opencode`, `evaluate:generic:opencode` | `evo artifact` oppure `evo module` |
| `discover:game:opencode`, `evolve:variants:opencode` | `evo benchmark`, `evo artifact`, `evo challenge` |
| `evolve:workspace:opencode`, `evaluate:workspace-candidate`, `promote:workspace-candidate` | percorso artifact/registry; mantenuti per le policy extension storiche |
| `archive:capabilities` | solo migrazione/backfill di archivi storici |

## CLI sperimentale: `evo`

La CLI organizza gli esperimenti in **sessioni**. Dopo `npm link` (oppure
`bun link`) dalla root del progetto, `evo` e' disponibile nella shell. Senza
link, gli stessi comandi si eseguono come `npm run cli -- <comando>`.

```bash
evo help
evo list
evo show discovery-<id>
evo benchmark all
evo artifact
```

### Deprecato: `evo new`

```bash
evo new
DISCOVERY_MAX_STEPS=30 DISCOVERY_CODE_ATTEMPTS=3 evo new baseline-30
```

`evo new` crea una sessione `discovery-<timestamp>` ed esegue una volta i sette
scenari fissi: consegna semplice, porta/chiave, variante speculare, doppia
consegna, due pacchi, batteria e detour. E' il benchmark riproducibile: per
ogni episodio registra esplorazione, capability JSON, codice candidato e
validazione. Per nuovi esperimenti usa `evo benchmark all`, poi `evo artifact`.

### Deprecato: `evo evolve`

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
`evolve-battery-return-<timestamp>`. Per nuovi esperimenti usa `evo artifact`
oppure `evo module`.

### Report e comandi legacy

```bash
evo show <run-id>
evo resume discovery-<id>
evo delete <run-id>          # anteprima
evo delete <run-id> --yes    # conferma la rimozione
```

`resume` completa esclusivamente una discovery interrotta e conserva i budget
registrati nel checkpoint. Le evoluzioni sono immutabili in questa prima
versione. `evo delete` rimuove soltanto artefatti delle sessioni storiche.

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

Il piano JSON non e' l'unico artefatto evolutivo. Il runtime espone un registro
di capability agnostico rispetto al dominio: ogni capability dichiara uno hook
di decisione, priorita' e funzione pura che puo' restituire un'azione oppure
delegare alla baseline. `src/agent-workspace/` contiene il substrate iniziale,
benchmark e contratti; non impone all'agente una tassonomia cognitiva fissa.

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

Il primo confine mutabile e' una **capability artifact**: vero codice JavaScript
che puo' sostituire una singola decisione, ma riceve soltanto un'osservazione
serializzabile, la scelta baseline e la memoria dell'episodio. Non riceve
filesystem, rete o un handle del gioco; il simulatore resta l'unico esecutore
delle azioni. Questo consente di far generare al modello euristiche di
precondizione, esplorazione, pianificazione dell'energia o qualsiasi altra
strategia motivata dai trace, mantenendo il cambiamento verificabile.

Una proposta storica di policy extension ha i campi `id`, `bottleneck`,
`module`, `rationale`, `expectedMetric` e `source`, dove `source` e' una sola
funzione JavaScript. Per provarla senza alterare l'agente base:

```bash
npm run evaluate:workspace-candidate -- proposta.json
```

Il percorso corrente per le capability dirette usa il contratto piu' stretto
`id`, `purpose`, `activation` e `source`; `source` deve essere un'unica arrow
function auto-contenuta e puo' essere agganciata solo allo hook `decision`.
Per generarne una e valutarla contro training e holdout:

```bash
npm run evolve:artifact
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
MODULE_PATCH_MODELS=llama-3.3-70b,qwen3.8-27b \
MODULE_PATCH_ATTEMPTS=2 \
npm run evolve:module-workspace
```

Per ispezionare una proposta JSON già disponibile senza chiamare un modello:

```bash
npm run evaluate:module-patch -- proposta-modulo.json
```

Seleziona soltanto l'episodio con la metrica peggiore, invia a OpenCode/LiteLLM
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
CHALLENGE_MODELS=llama-3.3-70b,qwen3.8-27b \
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
2. Configura il gateway UniTn LiteLLM come descritto in
   [Configurazione](#configurazione). La chiave resta in `.env`, mai in scenari
   o codice.
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

Il modello si seleziona con `OPENAI_MODEL`; vedi
[Configurazione](#configurazione) per gli ID e i default verificati.

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

`opencode.jsonc` configura il provider custom `unitn-litellm` sul gateway
OpenAI-compatible UniTn. Il token resta esclusivamente in `.env` tramite
`OPENAI_API_KEY`.

Gli scenari sono in `scenarios/`; `key-door-delivery.v1.json` e' il primo caso
versionato. Il validatore esegue il piano proposto su una copia dell'episodio:
la selezione di una capability non modifica mai lo stato reale dell'esperimento.

## Garanzie sperimentali

Il modello puo' proporre piani e codice, ma l'ambiente deterministico resta
l'unico esecutore. Ogni proposta passa parsing, contratto, sandbox, benchmark
training e holdout prima di diventare promuovibile; una capability non attivata
dal loop decisionale non puo' essere accettata come miglioramento.
