# Performance



Performance budgets, load testing, and caching strategy.



6 control(s).



### `perf.budgets-defined` — Performance budgets defined

- **phase**: build · **severity**: low · **effort**: small
- **detect**: `file-exists` · **fix**: —

A budget turns performance from an afterthought into a check: a change that blows the budget is caught instead of silently degrading the experience.

References:
  - [web.dev — Performance budgets](https://web.dev/articles/performance-budgets-101)

### `perf.bundle-size-budget` — Bundle size budget enforced

- **phase**: build · **severity**: low · **effort**: small
- **detect**: `file-exists` · **fix**: —

An enforced bundle budget stops JavaScript bloat creeping in one dependency at a time, which is the usual way web apps get slow.

References:
  - [web.dev — Your first performance budget](https://web.dev/articles/your-first-performance-budget)

### `perf.caching-strategy` — Caching strategy documented

- **phase**: harden · **severity**: low · **effort**: small
- **detect**: `file-matches` · **fix**: —

A written caching strategy (layers, TTLs, invalidation) prevents the two classic failures: no caching, and caching that serves stale data.

References:
  - [MDN — HTTP caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching)

### `perf.lighthouse-ci` — Lighthouse CI in the pipeline

- **phase**: harden · **severity**: low · **effort**: medium
- **detect**: `file-matches` · **fix**: —

Running Lighthouse on every change tracks Core Web Vitals over time and flags regressions before users feel them.

References:
  - [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci)

### `perf.load-test-before-launch` — Load test at expected peak before launch

- **phase**: launch · **severity**: medium · **effort**: medium
- **detect**: `manual` · **fix**: —

Finding the breaking point in a load test is far cheaper than finding it with real users on launch day.

References:
  - [k6 — Load testing](https://grafana.com/docs/k6/latest/)

### `perf.n-plus-one-detection` — N+1 query detection in tests

- **phase**: build · **severity**: low · **effort**: medium
- **detect**: `manual` · **fix**: —

N+1 queries are the most common ORM performance footgun; catching them in tests keeps a page's query count from quietly exploding.

References:
  - [Rails Guides — Eager loading](https://guides.rubyonrails.org/active_record_querying.html#eager-loading-associations)


