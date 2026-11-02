import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildContext, type GitHubClient } from "./context.js";
import { computeMetrics } from "./metrics.js";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const REPO = "https://api.github.com/repos/o/r";
const NOW = new Date("2026-11-01T00:00:00Z");
const daysAgo = (n: number): string =>
  new Date(NOW.getTime() - n * 86_400_000).toISOString();

async function client(): Promise<GitHubClient> {
  const gh = await buildContext("/tmp/x", {
    token: "t",
    github: { owner: "o", repo: "r" },
  }).github();
  if (!gh) throw new Error("expected a github client");
  return gh;
}

describe("computeMetrics", () => {
  it("computes the four DORA keys from API data", async () => {
    server.use(
      http.get(`${REPO}/releases`, () =>
        HttpResponse.json([
          { published_at: daysAgo(5) },
          { published_at: daysAgo(40) },
          { published_at: daysAgo(200) }, // outside the 90d window
        ]),
      ),
      http.get(`${REPO}/pulls`, () =>
        HttpResponse.json([
          {
            title: "feat: thing",
            created_at: daysAgo(10),
            merged_at: daysAgo(9), // 24h lead time
            head: { ref: "feat/thing" },
          },
          {
            title: "revert: oops",
            created_at: daysAgo(6),
            merged_at: daysAgo(6), // ~0h; a failure (revert)
            head: { ref: "revert-abc" },
          },
          {
            title: "chore: never merged",
            created_at: daysAgo(3),
            merged_at: null,
            head: { ref: "chore/x" },
          },
        ]),
      ),
      http.get(`${REPO}/issues`, () =>
        HttpResponse.json([
          {
            created_at: daysAgo(20),
            closed_at: daysAgo(19), // 24h to restore
          },
        ]),
      ),
    );

    const m = await computeMetrics(await client(), {
      now: NOW,
      windowDays: 90,
    });

    // 2 releases in 90 days (~12.86 weeks) → ~0.156/week
    expect(m.deploymentFrequencyPerWeek).toBeCloseTo(2 / (90 / 7), 3);
    expect(m.leadTimeHoursMedian).toBeCloseTo(12, 0); // median of [24, ~0]
    expect(m.changeFailureRate).toBeCloseTo(0.5, 5); // 1 of 2 merged is a revert
    expect(m.timeToRestoreHoursMedian).toBeCloseTo(24, 0);
    expect(m.assumptions.length).toBeGreaterThan(0);
  });

  it("returns null for metrics with no data", async () => {
    server.use(
      http.get(`${REPO}/releases`, () => HttpResponse.json([])),
      http.get(`${REPO}/pulls`, () => HttpResponse.json([])),
      http.get(`${REPO}/issues`, () => HttpResponse.json([])),
    );
    const m = await computeMetrics(await client(), { now: NOW });
    expect(m.deploymentFrequencyPerWeek).toBe(0);
    expect(m.leadTimeHoursMedian).toBeNull();
    expect(m.changeFailureRate).toBeNull();
    expect(m.timeToRestoreHoursMedian).toBeNull();
  });

  it("ignores pull requests returned by the issues endpoint", async () => {
    server.use(
      http.get(`${REPO}/releases`, () => HttpResponse.json([])),
      http.get(`${REPO}/pulls`, () => HttpResponse.json([])),
      http.get(`${REPO}/issues`, () =>
        HttpResponse.json([
          {
            pull_request: { url: "x" }, // a PR, not an incident
            created_at: daysAgo(5),
            closed_at: daysAgo(4),
          },
        ]),
      ),
    );
    const m = await computeMetrics(await client(), { now: NOW });
    expect(m.timeToRestoreHoursMedian).toBeNull();
  });

  it("returns null (not Infinity/NaN) for deployment frequency on an empty window", async () => {
    server.use(
      http.get(`${REPO}/releases`, () => HttpResponse.json([])),
      http.get(`${REPO}/pulls`, () => HttpResponse.json([])),
      http.get(`${REPO}/issues`, () => HttpResponse.json([])),
    );
    // windowDays <= 0 means deploys / (windowDays / 7) is a divide-by-zero.
    // Every other metric returns null when it can't be computed honestly;
    // deployment frequency must too (matching the issue's suggested guard).
    const m = await computeMetrics(await client(), { now: NOW, windowDays: 0 });
    expect(m.deploymentFrequencyPerWeek).toBeNull();
  });
});
