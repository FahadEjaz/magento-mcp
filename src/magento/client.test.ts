import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSearchCriteriaQuery, magentoClient } from "./client.js";
import { MagentoApiError } from "./types.js";

vi.mock("./oauth.js", () => ({
  getOAuthHeader: vi.fn().mockReturnValue({ Authorization: 'OAuth oauth_signature="fake"' }),
}));

const { getOAuthHeader } = await import("./oauth.js");

describe("buildSearchCriteriaQuery", () => {
  it("builds filter groups, sort orders, and pagination params", () => {
    const qs = buildSearchCriteriaQuery({
      filterGroups: [{ filters: [{ field: "sku", value: "%abc%", conditionType: "like" }] }],
      sortOrders: [{ field: "name", direction: "ASC" }],
      pageSize: 20,
      currentPage: 2,
    });
    const params = new URLSearchParams(qs);
    expect(params.get("searchCriteria[filterGroups][0][filters][0][field]")).toBe("sku");
    expect(params.get("searchCriteria[filterGroups][0][filters][0][value]")).toBe("%abc%");
    expect(params.get("searchCriteria[filterGroups][0][filters][0][conditionType]")).toBe("like");
    expect(params.get("searchCriteria[sortOrders][0][field]")).toBe("name");
    expect(params.get("searchCriteria[sortOrders][0][direction]")).toBe("ASC");
    expect(params.get("searchCriteria[pageSize]")).toBe("20");
    expect(params.get("searchCriteria[currentPage]")).toBe("2");
  });

  it("defaults conditionType to eq when omitted", () => {
    const qs = buildSearchCriteriaQuery({
      filterGroups: [{ filters: [{ field: "status", value: "complete" }] }],
    });
    const params = new URLSearchParams(qs);
    expect(params.get("searchCriteria[filterGroups][0][filters][0][conditionType]")).toBe("eq");
  });

  it("produces an empty query string for empty criteria", () => {
    expect(buildSearchCriteriaQuery({})).toBe("");
  });
});

describe("magentoClient request handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getOAuthHeader as ReturnType<typeof vi.fn>).mockReturnValue({
      Authorization: 'OAuth oauth_signature="fake"',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns parsed JSON on a successful GET, signed with an OAuth1 header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ sku: "ABC" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await magentoClient.get<{ sku: string }>("/products/ABC");

    expect(result).toEqual({ sku: "ABC" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('OAuth oauth_signature="fake"');
    expect(getOAuthHeader).toHaveBeenCalledWith(url, "GET");
  });

  it("signs POST/PUT/DELETE with the correct method", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);

    await magentoClient.post("/products", { product: { sku: "ABC" } });
    expect(getOAuthHeader).toHaveBeenLastCalledWith(expect.any(String), "POST");

    await magentoClient.delete("/products/ABC");
    expect(getOAuthHeader).toHaveBeenLastCalledWith(expect.any(String), "DELETE");
  });

  it("returns undefined on a 204 No Content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await magentoClient.delete("/products/ABC");
    expect(result).toBeUndefined();
  });

  it("throws MagentoApiError with status and message on a non-2xx response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Requested product doesn't exist", parameters: ["ABC"] }), {
        status: 404,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(magentoClient.get("/products/ABC")).rejects.toMatchObject({
      name: "MagentoApiError",
      status: 404,
      message: "Requested product doesn't exist",
    });
  });

  it("throws MagentoApiError on a 401 (invalid/revoked OAuth credentials) with no retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "The consumer isn't authorized to access %resources" }), {
        status: 401,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(magentoClient.get("/products/ABC")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to statusText when the error body isn't valid JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("not json", { status: 500, statusText: "Internal Server Error" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(magentoClient.get("/products/ABC")).rejects.toMatchObject({
      status: 500,
      message: "Internal Server Error",
    });
  });

  it("serializes the body for POST/PUT requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await magentoClient.post("/products", { product: { sku: "ABC" } });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ product: { sku: "ABC" } }));
  });

  it("wraps a network failure (e.g. site unreachable) with a clear, actionable message", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(magentoClient.get("/products/ABC")).rejects.toThrow(/Could not reach Magento/);
  });
});
