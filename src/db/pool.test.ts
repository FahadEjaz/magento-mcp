import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockConnection = {
  query: vi.fn(),
  release: vi.fn(),
};

vi.mock("mysql2/promise", () => ({
  default: {
    createPool: vi.fn(() => ({
      getConnection: vi.fn().mockResolvedValue(mockConnection),
    })),
  },
}));

const { runReadOnlyQuery } = await import("./pool.js");
const { config } = await import("../config.js");

describe("runReadOnlyQuery", () => {
  beforeEach(() => {
    mockConnection.query.mockReset();
    mockConnection.release.mockReset();
  });

  it("sets a session query timeout before running the query", async () => {
    mockConnection.query
      .mockResolvedValueOnce([[], []]) // SET SESSION MAX_EXECUTION_TIME
      .mockResolvedValueOnce([[{ sku: "ABC" }], [{ name: "sku" }]]); // the actual query

    await runReadOnlyQuery("SELECT sku FROM catalog_product_entity LIMIT 500");

    expect(mockConnection.query).toHaveBeenNthCalledWith(
      1,
      `SET SESSION MAX_EXECUTION_TIME=${config.db!.queryTimeoutMs}`
    );
    expect(mockConnection.query).toHaveBeenNthCalledWith(
      2,
      "SELECT sku FROM catalog_product_entity LIMIT 500"
    );
  });

  it("maps rows and field names into a QueryResult", async () => {
    mockConnection.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ sku: "ABC" }, { sku: "DEF" }], [{ name: "sku" }]]);

    const result = await runReadOnlyQuery("SELECT sku FROM catalog_product_entity");

    expect(result).toEqual({
      rows: [{ sku: "ABC" }, { sku: "DEF" }],
      fields: ["sku"],
    });
  });

  it("handles an empty fields array (e.g. driver returns undefined)", async () => {
    mockConnection.query.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[], undefined]);

    const result = await runReadOnlyQuery("SELECT 1");

    expect(result.fields).toEqual([]);
  });

  it("always releases the connection, even when the query throws", async () => {
    mockConnection.query.mockResolvedValueOnce([[], []]).mockRejectedValueOnce(new Error("boom"));

    await expect(runReadOnlyQuery("SELECT 1")).rejects.toThrow("boom");
    expect(mockConnection.release).toHaveBeenCalledTimes(1);
  });

  it("releases the connection on the happy path too", async () => {
    mockConnection.query.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[], []]);

    await runReadOnlyQuery("SELECT 1");
    expect(mockConnection.release).toHaveBeenCalledTimes(1);
  });
});

describe("runReadOnlyQuery timeout fallback (isolated module state)", () => {
  it("falls back to MariaDB's max_statement_time when MAX_EXECUTION_TIME isn't supported, and still runs the query", async () => {
    vi.resetModules();

    const freshConnection = { query: vi.fn(), release: vi.fn() };
    vi.doMock("mysql2/promise", () => ({
      default: {
        createPool: vi.fn(() => ({
          getConnection: vi.fn().mockResolvedValue(freshConnection),
        })),
      },
    }));

    const { runReadOnlyQuery: freshRunReadOnlyQuery } = await import("./pool.js");
    const { config: freshConfig } = await import("../config.js");

    freshConnection.query
      .mockRejectedValueOnce(new Error("Unknown system variable 'MAX_EXECUTION_TIME'")) // MySQL variant fails on MariaDB
      .mockResolvedValueOnce([[], []]) // MariaDB variant succeeds
      .mockResolvedValueOnce([[{ sku: "ABC" }], [{ name: "sku" }]]); // the actual query

    const result = await freshRunReadOnlyQuery("SELECT sku FROM catalog_product_entity");

    expect(freshConnection.query).toHaveBeenNthCalledWith(
      2,
      `SET SESSION max_statement_time=${Math.ceil(freshConfig.db!.queryTimeoutMs / 1000)}`
    );
    expect(result).toEqual({ rows: [{ sku: "ABC" }], fields: ["sku"] });

    vi.doUnmock("mysql2/promise");
  });

  it("still runs the query even when neither timeout variant is supported", async () => {
    vi.resetModules();

    const freshConnection = { query: vi.fn(), release: vi.fn() };
    vi.doMock("mysql2/promise", () => ({
      default: {
        createPool: vi.fn(() => ({
          getConnection: vi.fn().mockResolvedValue(freshConnection),
        })),
      },
    }));

    const { runReadOnlyQuery: freshRunReadOnlyQuery } = await import("./pool.js");

    freshConnection.query
      .mockRejectedValueOnce(new Error("unsupported")) // MySQL variant fails
      .mockRejectedValueOnce(new Error("unsupported")) // MariaDB variant also fails
      .mockResolvedValueOnce([[{ sku: "ABC" }], [{ name: "sku" }]]); // the actual query still runs

    const result = await freshRunReadOnlyQuery("SELECT sku FROM catalog_product_entity");

    expect(result).toEqual({ rows: [{ sku: "ABC" }], fields: ["sku"] });
    expect(freshConnection.release).toHaveBeenCalledTimes(1);

    vi.doUnmock("mysql2/promise");
  });
});

describe("runReadOnlyQuery with an SSH tunnel configured (isolated module state)", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.doUnmock("mysql2/promise");
    vi.doUnmock("./ssh-tunnel.js");
  });

  it("connects the pool to the tunnel's local forwarded port instead of MAGENTO_DB_HOST directly", async () => {
    vi.resetModules();
    process.env.MAGENTO_DB_SSH_HOST = "bastion.example.com";
    process.env.MAGENTO_DB_SSH_USER = "deploy";
    process.env.MAGENTO_DB_SSH_PASSWORD = "hunter2";

    const openSshTunnel = vi.fn().mockResolvedValue({ localPort: 54321, close: vi.fn() });
    vi.doMock("./ssh-tunnel.js", () => ({ openSshTunnel }));

    const freshConnection = { query: vi.fn().mockResolvedValue([[], []]), release: vi.fn() };
    const createPool = vi.fn(() => ({ getConnection: vi.fn().mockResolvedValue(freshConnection) }));
    vi.doMock("mysql2/promise", () => ({ default: { createPool } }));

    const { runReadOnlyQuery: freshRunReadOnlyQuery } = await import("./pool.js");
    const { config: freshConfig } = await import("../config.js");

    await freshRunReadOnlyQuery("SELECT 1");

    expect(openSshTunnel).toHaveBeenCalledWith(
      expect.objectContaining({ host: "bastion.example.com", username: "deploy", password: "hunter2" }),
      freshConfig.db!.host,
      freshConfig.db!.port
    );
    expect(createPool).toHaveBeenCalledWith(expect.objectContaining({ host: "127.0.0.1", port: 54321 }));
  });

  it("does not attempt a tunnel when MAGENTO_DB_SSH_HOST is unset", async () => {
    vi.resetModules();
    delete process.env.MAGENTO_DB_SSH_HOST;

    const openSshTunnel = vi.fn();
    vi.doMock("./ssh-tunnel.js", () => ({ openSshTunnel }));

    const freshConnection = { query: vi.fn().mockResolvedValue([[], []]), release: vi.fn() };
    const createPool = vi.fn(() => ({ getConnection: vi.fn().mockResolvedValue(freshConnection) }));
    vi.doMock("mysql2/promise", () => ({ default: { createPool } }));

    const { runReadOnlyQuery: freshRunReadOnlyQuery } = await import("./pool.js");

    await freshRunReadOnlyQuery("SELECT 1");

    expect(openSshTunnel).not.toHaveBeenCalled();
  });
});
