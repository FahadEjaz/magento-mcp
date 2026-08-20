import { describe, expect, it } from "vitest";
import { assertSafeSelect, QueryRejectedError } from "./guard.js";

describe("assertSafeSelect", () => {
  it("allows a plain select and injects a LIMIT", () => {
    const result = assertSafeSelect("SELECT sku, name FROM catalog_product_entity");
    expect(result).toBe("SELECT sku, name FROM catalog_product_entity LIMIT 500");
  });

  it("keeps an existing LIMIT under the max", () => {
    const result = assertSafeSelect("SELECT * FROM sales_order LIMIT 10");
    expect(result).toBe("SELECT * FROM sales_order LIMIT 10");
  });

  it("caps an existing LIMIT over the max", () => {
    const result = assertSafeSelect("SELECT * FROM sales_order LIMIT 10000");
    expect(result).toBe("SELECT * FROM sales_order LIMIT 500");
  });

  it("does not false-positive on updated_at / created_at column names", () => {
    const result = assertSafeSelect("SELECT updated_at, created_at FROM sales_order");
    expect(result).toContain("updated_at");
  });

  it("rejects non-SELECT statements", () => {
    expect(() => assertSafeSelect("UPDATE sales_order SET status='x'")).toThrow(QueryRejectedError);
    expect(() => assertSafeSelect("DELETE FROM sales_order")).toThrow(QueryRejectedError);
    expect(() => assertSafeSelect("DROP TABLE sales_order")).toThrow(QueryRejectedError);
  });

  it("rejects stacked statements", () => {
    expect(() =>
      assertSafeSelect("SELECT * FROM sales_order; DROP TABLE sales_order;")
    ).toThrow(QueryRejectedError);
  });

  it("rejects file-write primitives", () => {
    expect(() =>
      assertSafeSelect("SELECT * FROM sales_order INTO OUTFILE '/tmp/x.csv'")
    ).toThrow(QueryRejectedError);
  });

  it("rejects access to sensitive tables", () => {
    expect(() => assertSafeSelect("SELECT * FROM admin_user")).toThrow(QueryRejectedError);
    expect(() => assertSafeSelect("SELECT * FROM oauth_consumer")).toThrow(QueryRejectedError);
    expect(() => assertSafeSelect("SELECT * FROM integration")).toThrow(QueryRejectedError);
  });

  it("rejects timing/DoS primitives", () => {
    expect(() => assertSafeSelect("SELECT SLEEP(300)")).toThrow(QueryRejectedError);
    expect(() => assertSafeSelect("SELECT BENCHMARK(1000000000, MD5('x'))")).toThrow(QueryRejectedError);
    expect(() => assertSafeSelect("SELECT GET_LOCK('x', 300)")).toThrow(QueryRejectedError);
    expect(() => assertSafeSelect("SELECT * FROM sales_order PROCEDURE ANALYSE()")).toThrow(QueryRejectedError);
  });

  it("rejects empty input", () => {
    expect(() => assertSafeSelect("   ")).toThrow(QueryRejectedError);
  });

  it("caps the row count in MySQL's 'LIMIT offset, row_count' form instead of reading the offset as the cap", () => {
    const result = assertSafeSelect("SELECT * FROM sales_order LIMIT 0, 50000");
    expect(result).toBe("SELECT * FROM sales_order LIMIT 500");
  });

  it("caps 'LIMIT offset, row_count' and preserves a non-zero offset", () => {
    const result = assertSafeSelect("SELECT * FROM sales_order LIMIT 20, 50000");
    expect(result).toBe("SELECT * FROM sales_order LIMIT 500 OFFSET 20");
  });

  it("keeps 'LIMIT offset, row_count' unchanged when row_count is already under the max", () => {
    const result = assertSafeSelect("SELECT * FROM sales_order LIMIT 10, 50");
    expect(result).toBe("SELECT * FROM sales_order LIMIT 10, 50");
  });

  it("caps 'LIMIT row_count OFFSET offset' without producing a duplicate LIMIT clause", () => {
    const result = assertSafeSelect("SELECT * FROM sales_order LIMIT 100000 OFFSET 5");
    expect(result).toBe("SELECT * FROM sales_order LIMIT 500 OFFSET 5");
  });

  it("keeps 'LIMIT row_count OFFSET offset' unchanged when under the max", () => {
    const result = assertSafeSelect("SELECT * FROM sales_order LIMIT 50 OFFSET 5");
    expect(result).toBe("SELECT * FROM sales_order LIMIT 50 OFFSET 5");
  });

  it("does not false-positive on forbidden keywords appearing inside a string literal", () => {
    const result = assertSafeSelect(
      "SELECT entity_id FROM sales_order WHERE customer_note LIKE '%please update my address%'"
    );
    expect(result).toContain("please update my address");
  });

  it("does not false-positive on a sensitive table name appearing inside a string literal", () => {
    const result = assertSafeSelect("SELECT entity_id FROM sales_order WHERE comment = 'see admin_user for details'");
    expect(result).toContain("admin_user");
  });

  it("still rejects a real reference to a sensitive table outside a string literal", () => {
    expect(() => assertSafeSelect("SELECT * FROM admin_user WHERE username = 'x'")).toThrow(QueryRejectedError);
  });

  it("allows a single statement ending in a trailing comment after the semicolon", () => {
    const result = assertSafeSelect("SELECT 1; -- trailing comment");
    expect(result).toBe("SELECT 1 LIMIT 500");
  });

  it("still rejects stacked statements even when string literals contain semicolons", () => {
    expect(() =>
      assertSafeSelect("SELECT * FROM sales_order WHERE note = 'a;b'; DROP TABLE sales_order;")
    ).toThrow(QueryRejectedError);
  });
});
