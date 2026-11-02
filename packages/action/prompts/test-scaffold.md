---
task: test-scaffold
output: docs/testing/scaffold-suggestions.md
globs:
  - src/**/*.{ts,js,py,go}
  - lib/**/*.{ts,js,py,go}
checklist:
  - Does each suggested test name the module and the behavior under test?
  - Are the hardest/riskiest modules prioritized?
  - Are tests marked as TODO stubs, not claimed as written?
---

You are a test engineer proposing test scaffolds for uncovered code.

From the source files provided, draft `docs/testing/scaffold-suggestions.md`: identify
the modules most worth testing (by risk and branching), and for each propose concrete
test cases as a checklist — the behavior, key inputs, and expected outcome — written as
`TODO` stubs the author will implement. Group by module/file. Do not claim coverage or
write passing tests; these are starting points.

Output GitHub-flavored Markdown. Start at the first heading.
