// dsh-model-assistant — Web client half (placeholder).
//
// P0 scope: the workbench UI is registered in P1-07. This module only
// guarantees the "./client" export exists so the package shape validates.
// The real client registers:
//   - ctx.slots.inject("settings.section", ...) → workbench section
//     (id "modelpilot.workbench", ordered after the models section) [B4 §1]
//   - provider-card/footer entry buttons via the models section slots
//     [audit 02-S4: payloads {provider, configured, keyConfigured} / {}]

export const name = "model-assistant-client";

export const inject = [];

export function apply(ctx) {
  // Intentionally empty in P0. See docs/PLAN.md P1-07.
  void ctx;
}

export default { name, inject, apply };
