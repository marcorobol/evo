import type { AgentCapability } from "./contracts.js";

/** Contract-only initially: environments may later provide teammate intentions. */
/** Legacy implementation detail; not advertised as a predeclared capability. */
export const coordinationModule: AgentCapability = {
  id: "coordination",
  version: 1,
  purpose: "Reserve tasks and exchange intentions when an environment exposes multiple agents.",
};
