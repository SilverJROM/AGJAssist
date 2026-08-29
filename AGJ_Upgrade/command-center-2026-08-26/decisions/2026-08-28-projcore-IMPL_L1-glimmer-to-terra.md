# Decision — reroute IMPL_L1 off glimmer for the rest of the week (2026-08-28)

logged by `[projcore]` (x-02_projcore_sonnet5_agjassist). Model routing is autonomous under
projcore.md §1 ("effort tier, model routing, refactor-or-not, clean-code calls — never a question,
JROM-LOCKED"), so this is my call, not a north escalation — logged here because it changes engine
config for the rest of this run.

## Why
Glimmer (Muse Glimmer 30B) is on the same grok weekly quota that killed the grok46 coordinator earlier
today (0% left, confirmed live on this run's F0c pane and independently on an unrelated concurrent run's
glimmer pane). North confirmed the quota does not reset until **Sat 2026-08-29 23:30 Manila (~1.3 days
out)** — glimmer cannot recover on a respawn between now and then. Every remaining slice (F0c, F7, E5,
G1, G2) enters at L1=glimmer per the engine's JROM-LOCKED "every atomic task enters at L1" rule, so left
unrouted, all five would burn their 2-respawn-per-slice self-heal bound on a seat that is guaranteed to
wedge, before ever reaching a working tier.

## What was decided
`IMPL_L1: glimmer -> terra` in run.env. `IMPL_L1_ESC` stays `terra` (now a same-tier no-op escalation,
harmless). L2/L3/L4 unchanged (terra/sonnet5/sol). Terra (codex gpt-5.6), sol (codex), sonnet5 (claude)
and codex55 (validator) are all off the grok quota — none of this ladder is affected by the Sat reset.

## Mechanism
North offered to execute the identical pin+restart procedure already used today for the VAL_L1/L2
grok46->sonnet5 swap (see `2026-08-28-north-D7-F7.md`/validator-swap decision): edit run.env on the pin
at `~/.tiller-pinned/agj-command-center/`, restart the driver with `TILLER_ADOPT_CONFIG=1` so it adopts
the new value deliberately (driver logs "CONFIG UNVERIFIED... adopt deliberately" otherwise). I asked
north to execute it (~2 min), since north already holds the tested recipe from this morning's swap.
verifier != fixer unaffected — this only touches implementer routing, not the validator ladder.

## Not a north matter, logged for the record
Does not change og-requirements, scope, or what "done" means for any slice — same acceptance bar, just a
healthy implementer tier instead of a quota-dead one.
