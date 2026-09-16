# Evolvable agent workspace

This directory is the contract for code-level evolution. The agent may inspect
and propose changes to modules in `src/agent-workspace/`, but must not modify a
module without running the benchmark suite and preserving prior passing cases.

There is no fixed list of cognitive modules. The substrate exposes observations,
declared primitive actions, episodic traces and a benchmark gate. A proposed
capability receives an identifier invented from evidence in the traces; its
name must not be selected from a host-provided taxonomy.

Each change proposal must name: the observed bottleneck, files to modify, the
expected metric change, and regression benchmarks. Generated code is accepted
only after a separate holdout benchmark passes.

The first mutable boundary is a capability artifact (`evo artifact`). A model
emits one JavaScript arrow expression in the `capabilityArtifactSchema` shape;
it receives only a read-only serializable observation, baseline decision, and
episodic memory. It may return one valid primitive action or `undefined` to
defer to the baseline. It has no imports, process, network, filesystem, or
game handle, and each decision call is bounded by a sandbox timeout. An
evaluated artifact stays promotable until the host activates it with
`evo promote <artifact-run-id>`. A candidate is promotable only if it improves
a training score, has no training-score regression, and retains all baseline
holdout successes.

The second mutable boundary is a capability revision. It must be a JSON proposal
containing complete TypeScript contents only for the neutral editable surface
declared by `modulePatchManifest()` in `src/agent-workspace/module-patch.ts`.
The host applies it only to a disposable cloned `src/` tree, evaluates fixed
scenarios plus seeded family training/holdout, then deletes that clone. The
model has no path to overwrite the real workspace or promote a revision.
