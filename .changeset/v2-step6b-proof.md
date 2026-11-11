---
"@arynbht/factory-runtime": minor
"@arynbht/factory-catalog": minor
"@arynbht/factory-engine": minor
"@arynbht/factory-cli": minor
---

Factory v2 step 6b: the proof runner. `factory task prove <id>` produces the
assembly's proof with tools. For UI tasks it serves the base and the change side by
side (profile `proof.start` / `proof.url`), shoots each card `pages:` entry at three
breakpoints with Playwright, runs axe on the change (serious or critical violations
fail the proof), and uploads the images to an orphan `evidence` branch through the
Contents API. Every other proof type runs the test script and names the tests the
change added. Results go to the ledger and `proof/proof.json`; a failed proof sends
the task back to build, and the next round is told why.
