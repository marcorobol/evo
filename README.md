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
| Capability artifact | `CAPABILITY_ARTIFACT_MODEL`, `CAPABILITY_ARTIFACT_RUN_ID` | modello principale, ID timestamp |
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
| Promuovere un artifact validato | `evo promote <artifact-run-id>` | Corrente |
| Ciclo automatico controllato | `evo evolve --iterations N [--model ID]` | Corrente |
| Evolvere patch TypeScript | `evo module [--attempts N] [--models ID,ID] [--from-scratch]` | Corrente sperimentale |
| Cercare nuove challenge | `evo challenge [--attempts N] [--models ID,ID]` | Corrente sperimentale |
| Consultare i report | `evo list`, `evo show <run-id>` | Corrente |
| Gioco Deliveroo.js live | `npm run start:deliveroo`, `npm run play:live:evolving` | Integrazione/demo |
| Verificare LiteLLM/OpenCode | `npm run probe:opencode:qwen`, `npm run reproduce:opencode:plan` | Diagnostica |

Gli script npm rimangono disponibili sia per automazione sia per riprodurre
esperimenti. I flussi moderni sono:

| Script npm | Equivalente CLI | Stato |
| --- | --- | --- |
| `benchmark:workspace`, `benchmark:families` | `evo benchmark workspace`, `evo benchmark families` | Corrente |
| `evolve:artifact` | `evo artifact` | Corrente |
| `evolve:module-workspace` | `evo module`; valutazione manuale con `bun run src/evaluate-module-patch.ts` | Corrente sperimentale |
| `discover:challenge:opencode` | `evo challenge` | Corrente sperimentale |
| `start`, `start:deliveroo`, `play:live:evolving` | — | Demo/integration |
| `probe:opencode`, `probe:opencode:qwen`, `reproduce:opencode:plan` | — | Diagnostica |

## CLI sperimentale: `evo`

La CLI organizza gli esperimenti in **sessioni**. Dopo `npm link` (oppure
`bun link`) dalla root del progetto, `evo` e' disponibile nella shell. Senza
link, gli stessi comandi si eseguono come `npm run cli -- <comando>`.

```bash
evo help
evo list
evo show <run-id>
evo benchmark all
evo artifact
```

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

### Capability artifact → benchmark

Il primo confine mutabile e' una **capability artifact**: vero codice JavaScript
che puo' sostituire una singola decisione, ma riceve soltanto un'osservazione
serializzabile, la scelta baseline e la memoria dell'episodio. Non riceve
filesystem, rete o un handle del gioco; il simulatore resta l'unico esecutore
delle azioni. Questo consente di far generare al modello euristiche di
precondizione, esplorazione, pianificazione dell'energia o qualsiasi altra
strategia motivata dai trace, mantenendo il cambiamento verificabile.

Il percorso corrente per le capability dirette usa il contratto piu' stretto
`id`, `purpose`, `activation` e `source`; `source` deve essere un'unica arrow
function auto-contenuta e puo' essere agganciata solo allo hook `decision`.
Per generarne una e valutarla contro training e holdout:

```bash
evo artifact
```

Il valutatore compila il candidato in un VM minimale, confronta baseline e
candidato su scenari fissi e famiglie generate, divise in training e holdout,
e salva obiettivi aggregati. Una proposta e' **promotable** solo se migliora
fitness di training senza regressioni in training o holdout.

Un artifact valutato positivamente resta soltanto **promotable**: l'attivazione
e' una decisione esplicita dell'host. Per attivarlo nel registry persistente,
che viene caricato dai benchmark e dalle valutazioni successive:

```bash
evo promote artifact-evolve-<timestamp>
```

Per automatizzare il ciclo senza promuovere proposte non validate:

```bash
evo evolve --iterations 10
```

Ogni iterazione archivia sempre la proposta e il trace di valutazione; promuove
solo un miglioramento stretto e, dopo la promozione, rilancia i benchmark
workspace e delle famiglie. Il riepilogo del ciclo e' un report
`artifact-evolution-*.json` consultabile con `evo show`.

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
bun run src/evaluate-module-patch.ts proposta-modulo.json
```

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

## Struttura

- `src/belief-store.ts`: normalizzazione e stato delle percezioni.
- `src/deliveroo-gateway.ts`: unico adapter verso la SDK del gioco.
- `src/baseline-policy.ts`: baseline senza LLM.
- `src/trace-store.ts`: trace riproducibili per selezione e valutazione.
- `src/turn-based-environment.ts`: simulatore locale deterministico, con
  energia, batterie, chiavi, porte e double-delivery.
- `src/scenario-loader.ts`: schema Zod e loader per scenari JSON versionati.
- `src/capability-validator.ts`: esecuzione sandbox e fitness trasparente delle
  piani della demo locale.
- `src/agent-workspace/capability-artifact.ts`: contratto e compilazione delle
  capability dirette.
- `src/agent-workspace/capability-registry.ts`: registry che aggancia capability
  attive al loop decisionale.
- `src/turn-based-adapter.ts`: adapter che incapsula tutte le regole Deliveroo.

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
