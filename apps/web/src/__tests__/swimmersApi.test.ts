import { vi, describe, it, expect, beforeEach } from "vitest";

import { fetchSwimmers } from "../lib/api/swimmers";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const validSwimmer = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  firstName: "Alice",
  lastName: "Smith",
  birthDate: "2010-05-01",
  sex: "female",
  isPublic: false,
  publicConsentAt: null,
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
  clubs: [],
};

function mockResponse(ok: boolean, status: number, body: unknown): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("fetchSwimmers", () => {
  it("returns parsed swimmers on 200 with valid body", async () => {
    mockFetch.mockResolvedValue(mockResponse(true, 200, [validSwimmer]));
    const result = await fetchSwimmers("test-token");
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(validSwimmer.id);
    expect(result[0]?.firstName).toBe("Alice");
  });

  it("returns empty array on 200 with invalid response shape", async () => {
    mockFetch.mockResolvedValue(mockResponse(true, 200, [{ not: "a swimmer" }]));
    const result = await fetchSwimmers("test-token");
    expect(result).toEqual([]);
  });

  it("returns empty array on non-ok status", async () => {
    mockFetch.mockResolvedValue(mockResponse(false, 401, { error: "Unauthorized" }));
    const result = await fetchSwimmers("test-token");
    expect(result).toEqual([]);
  });

  it("returns empty array on 500", async () => {
    mockFetch.mockResolvedValue(mockResponse(false, 500, { error: "Internal server error" }));
    const result = await fetchSwimmers("test-token");
    expect(result).toEqual([]);
  });

  it("returns empty array when fetch throws (network error)", async () => {
    mockFetch.mockRejectedValue(new Error("Network failure"));
    const result = await fetchSwimmers("test-token");
    expect(result).toEqual([]);
  });

  it("forwards the access token as a Bearer header", async () => {
    mockFetch.mockResolvedValue(mockResponse(true, 200, []));
    await fetchSwimmers("my-token");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/swimmers/me"),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer my-token" }),
      }),
    );
  });
});
