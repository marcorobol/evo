# Baseline di implementazione: agente BDI auto-evolutivo su Deliveroo.js

## Decisione tecnica

Non conviene portare il prototipo `Deliveroo2` file per file. Il suo valore da
preservare e' il ciclo BDI con generazione, valutazione e riuso di capacita'; il
suo contratto di comunicazione, il modello eventi e l'esecuzione di codice
Python generato devono invece essere sostituiti.

La base proposta e' un nuovo progetto agente, in JavaScript/TypeScript, esterno
al monorepo del gioco e collegato alla SDK di `Deliveroo.js`. Il gioco rimane il
simulatore riproducibile; l'agente conserva una propria knowledge base,
catalogo delle capacita' e log sperimentale.

## Cosa si conserva dal prototipo Vaccari

- Belief revision asincrona, desideri a lungo termine, intenzioni eseguibili e
  trigger per riattivarle.
- Generazione di alternative, controllo dell'esecuzione e memoria del feedback.
- Registrazione separata di percezioni, azioni, valutazioni e costo delle
  richieste al modello.

## Cosa cambia con Deliveroo.js

| Tema | Deliveroo2 | Deliveroo.js attuale | Scelta |
| --- | --- | --- | --- |
| Connessione | Server TCP e messaggi JSON proprietari | Socket.io e SDK | Adapter `DeliverooGateway` basato sulla SDK |
| Percezioni | `object added/changed/removed` per tipo | Snapshot/eventi `map`, `tile`, `you`, `sensing` | Normalizzatore che produce eventi tipizzati interni |
| Azioni | Sei wrapper Python (`action_1` ... `action_6`) | `emitMove`, `emitPickup`, `emitPutdown` con acknowledgement | Catalogo di primitive async tipizzate |
| Stato | Dizionario libero aggiornato da codice generato | Mappa, agente, parcel, agenti e crate | Belief store con schema e versione |
| Codice LLM | `exec` di funzioni Python | Da definire | Piani dichiarativi validati, non codice arbitrario |

In particolare, `Deliveroo.js` offre le azioni di movimento, pickup e putdown e
le percezioni di mappa, agente e sensing. Nel ramo analizzato non espone ancora
le meccaniche sperimentali del paper - batteria/stazioni di ricarica, chiavi e
porte con chiave richiesta - ne' le relative azioni e percezioni. Quelle sono
quindi un'estensione dell'ambiente, non una semplice migrazione dell'agente.

## Architettura iniziale

```
Deliveroo.js SDK
      |
      v
DeliverooGateway -> Event normalizer -> BeliefStore
                                         |
                                         v
                         BDI deliberator <-> Capability registry
                                         |
                                         v
                                Plan executor -> Gateway
                                         |
                                         v
                   Trace store / fitness evaluator / capability archive
```

Il `Capability registry` e' l'unita' di ereditarieta': conserva primitive,
piani parametrizzati e condizioni d'applicabilita'. Una proposta del modello
diventa una capability candidata solo dopo validazione statica e test in un
episodio controllato. La selezione usa metriche osservabili (successo,
ricompensa, passi, energia, fallimenti), non soltanto una valutazione testuale
del modello.

## Primo incremento implementativo

**Obiettivo:** far girare un agente osservabile sul Deliveroo.js corrente,
senza ancora cambiare il gioco.

1. Creare il client TypeScript e il gateway SDK.
2. Materializzare e aggiornare beliefs per mappa, `you`, parcels, altri agenti
   e crate.
3. Esporre primitive sicure: muovi, raccogli, deposita, attendi, comunica.
4. Eseguire un piano baseline deterministico: cerca parcel, raccogli, raggiungi
   una tile di delivery, deposita.
5. Salvare per ogni episodio un trace JSONL con stato prima/dopo, azione,
   acknowledgement, reward e fallimento.
6. Aggiungere test di contratto sul normalizzatore e un replay dei trace.

Questo incremento isola il rischio di integrazione dal rischio LLM e fornisce
subito la baseline quantitativa necessaria al paper.

## Secondo incremento: evoluzione sperimentale

1. Estendere il backend con entita' e protocollo per `battery`, `charger`,
   `key` e `door`, inclusi eventi sensing e azioni (`recharge`, `unlock`).
2. Aggiungere tre livelli di evoluzione coerenti con il paper: KR (schema e
   regole di belief), GG (goals e piani), EX (composizione delle primitive).
3. Generare piu' candidati per ogni novita', testarli in sandbox/replay,
   selezionarli con una fitness esplicita e archiviarli con versione e
   provenienza.
4. Misurare riuso e raffinamento di capability, cosi' da distinguere davvero
   l'ereditarieta' dalla sola rigenerazione.

## Criteri sperimentali minimi

- Stesse seed, mappe e budget temporale per baseline e agente evolutivo.
- Metriche: parcel consegnati, reward, percentuale di piani validi, costo e
  latenza LLM, passi, immobilizzazioni, riuso/raffinamento di capability.
- Ablazioni: senza archivio, senza selezione quantitativa, senza evoluzione KR,
  senza evoluzione GG/EX.
- Nessuna chiave API nei trace o nel repository; configurazione solo tramite
  variabili d'ambiente.

## Decisioni da prendere prima del codice LLM

- Il primo artefatto deve essere un nuovo repository per l'agente oppure una
  cartella nel monorepo `Deliveroo.js`?
- Vogliamo costruire prima la baseline standard oppure le estensioni
  batteria/chiavi/porte del paper?
- Quale provider/modello e budget per gli esperimenti devono essere usati?
