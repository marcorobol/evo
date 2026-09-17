# Evolving Deliveroo Agent

Baseline sperimentale per un agente evolutivo su Deliveroo.js. Il controllo del
gioco e la persistenza dei trace sono deterministici; il modulo LLM genera
proposte strutturate e codice di capability, ma non esegue mai direttamente
azioni nell'ambiente.

Il percorso sperimentale principale e' ora l'ambiente locale turn-based:
`TurnBasedEnvironment.step(action)` avanza esattamente di un turno. Non ha
timer, rendering o socket, cosi' il validatore puo' scegliere quando far
progredire un episodio. Il collegamento al gioco originale passa direttamente
dal `DeliverooGateway` di `npm run start:deliveroo` e
`npm run play:live:evolving`.

## Avvio

1. Esegui `npm install`, poi `npm link` (o `bun link`) dalla root per rendere
   `evo` disponibile nella shell. Senza link: `npm run cli -- <comando>`.
2. Per l'integrazione opzionale con il gioco originale, avvia Deliveroo.js,
   copia `.env.example` in `.env` e usa `npm run start:deliveroo`.

Ogni azione viene registrata in `traces/` come JSONL. La policy iniziale cerca
parcel visibili, li raccoglie, calcola un percorso sulla mappa conosciuta e li
porta alla tile di consegna.

I comandi di evoluzione LLM usano il gateway UniTn LiteLLM configurato in
`.env`. I comandi locali (`evo benchmark`, `evo list`, `evo status`) non
richiedono una chiave API.

## Configurazione

Copia `.env.example` in `.env` e inserisci `OPENAI_API_KEY`. Il file `.env`
e' ignorato da Git. `evo` carica `.env` all'avvio; le variabili gia' esportate
dalla shell mantengono precedenza su quelle nel file.

Configurazione minima per il gateway UniTn:

```dotenv
OPENAI_BASE_URL=https://llm.bears.disi.unitn.it
OPENAI_API_KEY=<la-tua-chiave>
OPENAI_MODEL=qwen3.8-27b
```

Il suffisso `/v1` e' aggiunto automaticamente. Gli ID disponibili dal gateway
includono `llama-3.3-70b`, `qwen3.8-27b`, `qwen3-coder-next` e `gpt-4o`.

| Gruppo | Variabili | Default |
| --- | --- | --- |
| Modello | `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL` | gateway UniTn, chiave vuota, `qwen3.8-27b` |
| Gioco live | `DELIVEROO_URL`, `DELIVEROO_NAME`, `DELIVEROO_TOKEN`, `LIVE_ACTION_INTERVAL_MS` | vedi `.env.example` |
| Capability artifact | `CAPABILITY_ARTIFACT_MODEL`, `CAPABILITY_ARTIFACT_RUN_ID` | modello principale, ID timestamp |
| Sandbox decisionale | `CANDIDATE_DECISION_TIMEOUT_MS` | `100` |
| Regime | `EVOLUTION_BLANK_SLATE` | `0` |
| Patch modulari | `MODULE_PATCH_ATTEMPTS`, `MODULE_PATCH_MODELS`, `MODULE_PATCH_RUN_ID`, `EVOLUTION_FROM_SCRATCH` | `2`, Llama poi Qwen, ID timestamp, `0` |
| Challenge | `CHALLENGE_ATTEMPTS`, `CHALLENGE_MODELS`, `CHALLENGE_RUN_ID` | `2`, Llama poi Qwen, ID timestamp |

Tutto lo stato sperimentale e' locale e ignorato da Git: capability promosse
(`agent-workspace/discovered-capabilities/`), storia delle promozioni legacy
(`agent-workspace/promoted/`), archivio delle proposte, report e scenari
generati. Un clone fresco parte dal substrate puro; dopo un reset locale,
`bun run src/migrate-promoted-policies.ts` ricostruisce lo store promosso
dalla storia locale, se ancora presente.

## Riferimento comandi

| Obiettivo | Comando |
| --- | --- |
| Verificare il substrate | `npm test`, `npm run build` |
| Stato dell'esperimento | `evo status` |
| Eseguire benchmark | `evo benchmark all` |
| Generare capability diretta | `evo artifact [--model ID]` |
| Promuovere un artifact validato | `evo promote <artifact-run-id>` |
| Ciclo automatico controllato | `evo evolve --iterations N [--model ID]` |
| Evolvere patch TypeScript | `evo module [--attempts N] [--models ID,ID] [--from-scratch]` |
| Valutare proposta esistente | `evo evaluate <proposal.json>` |
| Cercare nuove challenge | `evo challenge [--attempts N] [--models ID,ID]` |
| Consultare i report | `evo list`, `evo show <run-id>` |
| Gioco Deliveroo.js live | `npm run start:deliveroo`, `npm run play:live:evolving` |

I flussi sono eseguiti in-process dalla CLI; `bun run src/<flow>.ts` funziona
ancora direttamente grazie al run-guard in ogni script.

## CLI sperimentale: `evo`

La CLI organizza gli esperimenti in **sessioni**. Eseguila dalla root del progetto.

```bash
evo help
evo status
evo list
evo show <run-id>
evo benchmark all
evo artifact
```

### Concorrenza

I comandi che modificano lo stato (`artifact`, `evolve`, `module`, `challenge`,
`promote`, `evaluate`) acquisiscono `.evo/lock` prima di avviarsi: un secondo
comando fallisce immediatamente nominando il detentore. `benchmark`, `list`,
`show` e `status` non bloccano mai.

### Metriche e token

`evo list` riporta successo, score e token. `evo show` mostra i dettagli per
episodio. Le colonne `IN`, `OUT` e `REASON` indicano rispettivamente token di
input, output finale e ragionamento.

Le richieste del loop sperimentale sono isolate: ogni decisione riceve un
manifest, l'osservazione corrente e un registro compatto delle evidenze.
Questo mantiene il costo per iterazione controllato. Ogni chiamata del codice
generato alla capability e' limitata da un timeout sandbox
(`CANDIDATE_DECISION_TIMEOUT_MS`).

## Workspace evolvibile dell'agente

Il runtime espone un registro di capability agnostico rispetto al dominio: ogni
capability dichiara un hook di decisione, priorita' e funzione pura che puo'
restituire un'azione oppure delegare al substrate. `src/agent-workspace/`
contiene il substrate iniziale, benchmark e contratti; non impone all'agente
una tassonomia cognitiva fissa.

Esegui il benchmark iniziale con:

```bash
evo benchmark workspace
```

Per misurare generalizzazione, esegui anche le famiglie deterministiche: i seed
di training sono disponibili al ciclo evolutivo, mentre quelli holdout restano
separati. La fitness riporta copertura, score medio e minimo, passi delle sole
esecuzioni riuscite, azioni bloccate e attese: un fallimento veloce non viene
mai premiato come efficienza.

```bash
evo benchmark families
```

Il runner salva un report in `reports/`. Una futura iterazione di codice deve
dichiarare il collo di bottiglia osservato, i moduli da modificare, la metrica
attesa e i benchmark di regressione; una modifica e' promossa solo se passa
training e holdout. Il contratto per un coding agent e' in
[`agent-workspace/AGENTS.md`](agent-workspace/AGENTS.md).

### Capability artifact → benchmark

Il primo confine mutabile e' una **capability artifact**: vero codice JavaScript
che puo' sostituire una singola decisione, ma riceve soltanto un'osservazione
serializzabile, la scelta baseline e la memoria dell'episodio. Non riceve
filesystem, rete o un handle del gioco; il simulatore resta l'unico esecutore
delle azioni.

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
e' una decisione esplicita dell'host. Per attivarlo nel registry persistente:

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

### Regime blank-slate puro

Di default il substrate ingegnerizzato (`baseline-policy`, navigazione e
task-selection) risolve gia' le consegne semplici e il prompt della generazione
contiene tre hint sulle meccaniche: l'evoluzione quindi non parte da una mente
vuota. Il flag `--blank-slate` (o `EVOLUTION_BLANK_SLATE=1`) attiva il regime
puro su `benchmark`, `artifact`, `evolve`, `module` e `challenge`:

- il substrate rinvia ogni decisione (`wait`): ogni punto di benchmark e'
  attribuibile solo alle capability evolute;
- il prompt della generazione non contiene hint di gioco: il modello ipotizza
  dai primi principi;
- il witness del challenge flow resta una ricerca esaustiva indipendente, quindi
  la solvibilita' continua a essere verificata.

In questo regime la baseline e' 0 ovunque, quindi le prime promozioni sono
facili e la selezione stringe man mano che lo stack cresce. Non mescolare i
regimi sullo stesso store promosso: azzera
`agent-workspace/discovered-capabilities/` quando passi da un regime all'altro.
Il flusso `module` riceve comunque i sorgenti della superficie modificabile:
e' revisione di codice esistente per costruzione.

### Revisioni modulari TypeScript

Per evolvere oltre una singola decisione, il modello puo' inventare una nuova
**capability** e proporre una revisione TypeScript completa. Non esiste una
lista host di moduli cognitivi: il manifest espone soltanto una superficie di
file modificabili. La revisione viene applicata esclusivamente a una copia
temporanea di `src/`, valutata contro baseline, famiglie training e holdout,
quindi eliminata. Il workspace reale non viene modificato ne' promosso dal modello.
Ogni proposta, anche se respinta, viene salvata immutabilmente in
`agent-workspace/capability-archive/` e fornita come lavoro precedente ai cicli
successivi.

```bash
evo module --attempts 2 --models llama-3.3-70b,qwen3.8-27b
```

Per ispezionare una proposta JSON gia' disponibile senza chiamare un modello:

```bash
evo evaluate proposta-modulo.json
```

Il file puo' essere una proposta grezza (`modulePatchProposalSchema`) oppure
una voce dell'archivio (il campo `proposal` viene estratto automaticamente).
Il file `bun run src/evaluate-module-patch.ts` funziona ancora direttamente.

Quando la suite e' satura, il meta-loop puo' cercare autonomamente una nuova
challenge, senza indicare all'agente come risolverla:

```bash
evo challenge --attempts 2 --models llama-3.3-70b,qwen3.8-27b
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
al modello perche' manca il rispettivo benchmark. Questo evita che un LLM produca
codice "creativo" senza segnale sperimentale.

## Struttura

- `src/belief-store.ts`: normalizzazione e stato delle percezioni.
- `src/deliveroo-gateway.ts`: unico adapter verso la SDK del gioco.
- `src/baseline-policy.ts`: baseline senza LLM.
- `src/trace-store.ts`: trace riproducibili per selezione e valutazione.
- `src/turn-based-environment.ts`: simulatore locale deterministico, con
  energia, batterie, chiavi, porte e double-delivery.
- `src/scenario-loader.ts`: schema Zod e loader per scenari JSON versionati.
- `src/agent-workspace/capability-artifact.ts`: contratto e compilazione delle
  capability dirette.
- `src/agent-workspace/capability-registry.ts`: registry che aggancia capability
  attive al loop decisionale.

Gli scenari sono in `scenarios/`; `key-door-delivery.v1.json` e' il primo caso
versionato. La selezione di una capability non modifica mai lo stato reale
dell'esperimento.

## Garanzie sperimentali

Il modello puo' proporre piani e codice, ma l'ambiente deterministico resta
l'unico esecutore. Ogni proposta passa parsing, contratto, sandbox, benchmark
training e holdout prima di diventare promuovibile; una capability non attivata
dal loop decisionale non puo' essere accettata come miglioramento.
