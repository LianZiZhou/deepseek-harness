# Agent Note: A person owns the system prompt their session runs under

Status: implemented

English | [中文](2026-09-19-user-owned-prompt-presets.zh.md)

## Problem

Every way to shape the system prompt belonged to whoever wrote the composition. `dsh-system-prompt`'s `personaPrefix` / `personaSuffix` are config on a `cordis.yml` row; `dsh-persona` is a row inside an agent preset; every other section belongs to the plugin that owns the fact it states. Its own README recorded the gap: *"there is no end-user prompt-editing API."* A person who wanted different instructions edited YAML and restarted, and nothing in the product showed them what the assembled prompt actually was.

The obvious shape — one more plugin, a `system-prompt/assemble` listener, a text box — does not hold up. A listener is not last by contract, and a registered `complete: true` section outranks it outright; the shipped `minimal` agent preset has one. The [final-override note](2026-09-18-prompt-final-override.md) covers that half. This note covers the feature built on it.

## Decision

`dsh-prompt-presets` stores **named, ordered rule stacks** in the user's settings document, and a session selects one and may switch at any point in its life.

### The rule stack

Five kinds, applied in array index order, each over the previous one's output: `prepend` and `append` add one section at an end, `replace` makes its text the whole prompt, `remove` drops sections by exact name, and `substitute` rewrites matching text. A rule may create a section only at the ends: there is no insert-at-order rule, because no consumer needs one and `remove` plus an end rule expresses the same result.

`applyRules` is pure and exported, so the live override and the preview answer identically rather than approximating each other.

### Selection is per session, and free

An agent preset locks after the first turn because swapping tools would strand logged tool calls. A prompt preset does not: the system prompt is a `system/message` surface node the next step re-renders, so a switch costs one rendering and reaches the model on the next turn without rewriting anything it already saw.

Which preset a session runs is read from its durable `promptPreset` projection on **every** assembly rather than cached per agent. Resume and fork then need no seeding code — the projection folds the log, and a fork's seed is a log prefix — and there is exactly one source for the question.

### Loud on write, contained on apply

A write rejects an unusable pattern, a flag outside `gimsu`, a bound exceeded, a removal naming a protected section, or a default naming an absent preset. Assembly does the opposite: a rule that still cannot run is skipped with a warning and the rest apply, and a preset whose result would not render is dropped for that assembly alone.

The asymmetry is the point. The write path is where a person is looking, and a settings document that could make assembly throw would make a session unrunnable from a text file. `Model-visible ⟺ logged` holds either way, because the rendered prompt is committed as `system/message` whichever rules survived.

### Protected sections

`Config.protectedSections` defaults to `tools:ptc-only` and `tool:structured_output`. Those two state rules the **executor** enforces — PTC mode, and the structured-output protocol for in-process children — so a prompt without them tells the model it may call tools that will be denied. A `replace` re-emits them ahead of its own text and warns; a `remove` naming one is refused at write time. It is a `Config` list, not a constant: a deployment that wants literally nothing protected sets `protectedSections: []`.

## Alternatives considered

**Edit the preset files instead.** Agent presets already have a roster, an authoring API, and a picker; a prompt override could have been another row in `agent.cordis.yml`. Rejected: preset authoring is copy-only by design and a preset file is an input the mount never writes back, so a GUI would have needed a second, writable authoring path — and the result would still lock after the first turn, which is exactly the constraint that does not apply to a prompt.

**A single free-text prompt override instead of a rule stack.** Simpler to build and to explain. Rejected because the common wants are *additive* ("always answer in Chinese", "never use emoji"), and a single text box forces a person to restate the whole first-party prompt to add one line — then silently rot when the harness changes it.

**Store presets as files under the harness home,** like agent presets. Rejected for v1: the settings document already has layering, validation, revisions, hot reload, and a client pipeline, and none of that would have been reusable. Sharing presets is the reason to revisit, and it is the same moment the regular-expression trust argument expires.

**Let `remove` take a pattern.** Rejected: the preview lists every section name, so click-to-remove is the interaction, and a second pattern grammar would add the regular-expression safety surface again for no new reach.

## Consequences

- A person can change the prompt from the product, and the change is decisive: it outranks the deployment persona and an agent preset's complete section alike.
- A session's prompt override is durable and reconstructable. `prompt-preset/selected` is an ordinary required event — `Session.append` cannot set the envelope's `ignorable` marker, which exists for event types a build does not know — so an older build refuses a log containing it, exactly as for every other in-repo event type added since.
- The blank-session default is stamped as a recorded selection rather than read at assembly, so a resumed session rebuilds the preset it ran instead of whatever the default later became.
- Rules reach the prompt and never the tool schemas. Hiding a tool stays `ctx.tools.restrict()`, which keeps presentation, lookup, and execution aligned; a preset that removed a tool's guidance would leave the tool callable.
- A pathological regular expression hangs its author's own turn. Pattern length, rule count, and text size are bounded, but Node cannot time out a regular expression, and the trust argument — a preset is the user's own settings document, which already carries `cordis.yml`'s trust — holds only while presets stay local.
- **Storage moved with the harness.** Upstream removed the separate settings document in favour of [profile-owned live configuration](2026-09-19-profile-owned-live-configuration.md), so `presets` and `default` are now volatile fields of this entry's own Config, written into the profile patch and committed without a remount. That supersedes the settings-namespace half of this decision and the file-storage alternative below it; the rule stack, per-session selection, and loud-on-write/contained-on-apply are unchanged. One consequence of the move: the Loader validates only a stored document's shape, so the protected-section rule is now also held at apply time, where a hand-edited `remove` is kept with a warning rather than honoured.

## Testing

- `packages/preset/prompt-presets/tests/rules.spec.ts` pins every rule kind, sequential composition including a rule targeting a section an earlier rule created, protected-section retention through a `replace`, and each contained failure.
- `packages/preset/prompt-presets/tests/override.spec.ts` pins per-session application and isolation, the mid-session switch, the override of a `complete: true` section, the render probe, and once-per-session warning logging.
- `packages/preset/prompt-presets/tests/store.spec.ts` and `schema.spec.ts` pin the roster, every write refusal, the revision fence, and the stored-document validation. Their harness boots a real profile, so each write goes through the settings forms, the profile patch, and the Loader's volatile commit.
- `packages/preset/prompt-presets/tests/profile-config.spec.ts` pins the read-only deployment with no settings service, and the warning a hand-edited document raises.
- `packages/preset/prompt-presets/tests/legacy-import.spec.ts` pins the upgrade: a `prompt-presets` section of the removed `settings.yaml` lands in the entry, default and newest rule kinds included, exactly once.
- `packages/preset/prompt-presets/tests/session.spec.ts` pins the projection fold, one event per change, and serialized concurrent selection.
- `packages/preset/prompt-presets/tests/preview.spec.ts` pins the baseline-and-candidate pair, section attribution, and each preview warning.
- `packages/preset/prompt-presets/tests/disposal.spec.ts` is the HMR-safety proof: the override, the settings form of the entry, the projection unit, and the event mirror all go with the fiber.
- `packages/preset/prompt-presets/tests/loader-composition.spec.ts` is the REAL-composition proof: the shipped rows boot through the Loader and the committed prompt carries the selected preset's transform, including over a composition that declared its persona complete.
