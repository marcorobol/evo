# Risultati sperimentali correnti

| Esperimento | Backend | Scenario | Esito | Azioni riuscite / fallite | Score Δ | Evidenza |
|---|---|---|---|---:|---:|---|
| Piano statico generato | LM Studio, `qwen/qwen3.8-27b` | `key-door-delivery` | Validato | 5 / 0 | +10 | Piano: `pickup → right → pickup → right → putdown`. |
| Generazione strutturata via SDK | OpenCode SDK + LM Studio, `qwen/qwen3.8-27b` | `key-door-delivery` | Risposta JSON valida, piano non validato | 3 / n.d. | n.d. | Il modello ha proposto `pickup → right → pickup`; mancava la consegna finale. |
| Esplorazione da zero | OpenCode SDK + LM Studio, `qwen/qwen3.8-27b` | `key-door-delivery` | Validata e salvata | 5 / 0 | +10 | L’agente ha scoperto tramite eventi e score la sequenza completa e ha salvato una capability generic. |
| Riuso di capability | Validatore deterministico | `key-door-delivery` | Riuso riuscito | 5 / 0 | +10 | La capability `key-gated-parcel-delivery` risulta usata una volta. |
| Valutazione curriculum | OpenCode SDK + LM Studio | 7 scenari pianificati | Interrotta | n.d. | n.d. | Il primo scenario è stato riusato; non è stato prodotto un report finale, quindi non ci sono metriche aggregate valide. |
| Campagna di scoperta separata | OpenCode SDK + LM Studio | Curriculum progressivo | Avviata, non conclusa | n.d. | n.d. | Run isolato e checkpointable; arrestata per liberare il server locale occupato. |

## Capability generic validate

| Nome | Piano | Score Δ | Stato |
|---|---|---:|---|
| `key-gated-parcel-delivery` | `pickup → right → pickup → right → putdown` | +10 | Validata; riusata una volta. |
| `keyed-door-parcel-delivery` | `pickup → right → pickup → right → putdown` | +10 | Validata; non ancora riusata. |

## Interpretazione

Il risultato centrale è che l’agente può passare da esplorazione azione-per-azione a una capability validata senza ricevere esplicitamente la semantica della cella di consegna. La valutazione su scenari non visti, inclusi il caso speculare e le varianti con batteria o ostacoli, resta il prossimo esperimento necessario.
