import { describe, expect, it, vi } from "vitest";

import {
  type DeviceCode,
  DeviceFlowError,
  type DeviceFlowDeps,
  pollForToken,
  requestDeviceCode,
} from "./device-flow";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const code: DeviceCode = {
  deviceCode: "dev-123",
  userCode: "WXYZ-1234",
  verificationUri: "https://github.com/login/device",
  expiresIn: 900,
  interval: 1,
};

function deps(fetchMock: DeviceFlowDeps["fetch"]): DeviceFlowDeps {
  return { fetch: fetchMock, sleep: () => Promise.resolve(), now: () => 0 };
}

describe("requestDeviceCode", () => {
  it("parses the device/user code response", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          device_code: "dev-123",
          user_code: "WXYZ-1234",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 5,
        }),
      ),
    );
    const result = await requestDeviceCode("client", "repo", deps(fetchMock));
    expect(result.userCode).toBe("WXYZ-1234");
    expect(result.deviceCode).toBe("dev-123");
  });

  it("throws on an error response", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ error_description: "bad client" }, false, 401),
      ),
    );
    await expect(
      requestDeviceCode("client", "repo", deps(fetchMock)),
    ).rejects.toBeInstanceOf(DeviceFlowError);
  });
});

describe("pollForToken", () => {
  it("returns the token after authorization_pending resolves", async () => {
    const replies = [
      jsonResponse({ error: "authorization_pending" }),
      jsonResponse({ error: "authorization_pending" }),
      jsonResponse({ access_token: "gho_secret" }),
    ];
    let call = 0;
    const fetchMock = vi.fn(() => Promise.resolve(replies[call++]!));
    const token = await pollForToken("client", code, deps(fetchMock));
    expect(token).toBe("gho_secret");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws on access_denied", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ error: "access_denied" })),
    );
    await expect(
      pollForToken("client", code, deps(fetchMock)),
    ).rejects.toBeInstanceOf(DeviceFlowError);
  });

  it("backs off to GitHub's interval on slow_down", async () => {
    const replies = [
      jsonResponse({ error: "slow_down", interval: 7 }),
      jsonResponse({ access_token: "gho_secret" }),
    ];
    let call = 0;
    const fetchMock = vi.fn(() => Promise.resolve(replies[call++]!));
    const slept: number[] = [];
    const token = await pollForToken("client", code, {
      fetch: fetchMock,
      sleep: (ms) => {
        slept.push(ms);
        return Promise.resolve();
      },
      now: () => 0,
    });
    expect(token).toBe("gho_secret");
    // first poll uses code.interval (1s); after slow_down it honors 7s.
    expect(slept).toEqual([1000, 7000]);
  });

  it("stops polling when the signal is aborted", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ error: "authorization_pending" })),
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      pollForToken("client", code, deps(fetchMock), controller.signal),
    ).rejects.toThrow(/cancelled/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives up once the code has expired", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ error: "authorization_pending" })),
    );
    // now() advances past the deadline on the first loop check, so it expires
    // before any token arrives (and never loops forever).
    let t = 0;
    const expired: DeviceFlowDeps = {
      fetch: fetchMock,
      sleep: () => Promise.resolve(),
      now: () => (t += 1_000_000),
    };
    await expect(pollForToken("client", code, expired)).rejects.toThrow(
      /expired/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
