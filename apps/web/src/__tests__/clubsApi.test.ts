import { vi, describe, it, expect, beforeEach } from "vitest";

import { fetchClubs } from "../lib/api/clubs";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const validClub = {
  id: "bbbbbbbb-0000-4000-8000-000000000002",
  name: "Sharks",
  isActive: true,
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
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

describe("fetchClubs", () => {
  it("returns parsed clubs on 200 with valid body", async () => {
    mockFetch.mockResolvedValue(mockResponse(true, 200, [validClub]));
    const result = await fetchClubs("test-token");
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(validClub.id);
    expect(result[0]?.name).toBe("Sharks");
  });

  it("returns empty array on 200 with invalid response shape", async () => {
    mockFetch.mockResolvedValue(mockResponse(true, 200, [{ not: "a club" }]));
    const result = await fetchClubs("test-token");
    expect(result).toEqual([]);
  });

  it("returns empty array on non-ok status", async () => {
    mockFetch.mockResolvedValue(mockResponse(false, 401, { error: "Unauthorized" }));
    const result = await fetchClubs("test-token");
    expect(result).toEqual([]);
  });

  it("returns empty array on 500", async () => {
    mockFetch.mockResolvedValue(mockResponse(false, 500, { error: "Internal server error" }));
    const result = await fetchClubs("test-token");
    expect(result).toEqual([]);
  });

  it("returns empty array when fetch throws (network error)", async () => {
    mockFetch.mockRejectedValue(new Error("Network failure"));
    const result = await fetchClubs("test-token");
    expect(result).toEqual([]);
  });

  it("forwards the access token as a Bearer header", async () => {
    mockFetch.mockResolvedValue(mockResponse(true, 200, []));
    await fetchClubs("my-token");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/clubs"),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer my-token" }),
      }),
    );
  });
});
