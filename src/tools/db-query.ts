import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "../config.js";
import { runReadOnlyQuery } from "../db/pool.js";
import { assertSafeSelect, QueryRejectedError } from "../db/guard.js";
import { errorResult, jsonResult } from "./shared.js";

const PREBUILT_QUERIES: Record<string, string> = {
  top_selling_products: `
    SELECT product_name, SUM(qty_ordered) AS total_qty_ordered
    FROM sales_order_item
    WHERE parent_item_id IS NULL
    GROUP BY product_name
    ORDER BY total_qty_ordered DESC
    LIMIT 20
  `,
  low_stock_items: `
    SELECT cpe.sku, csi.qty, csi.is_in_stock
    FROM cataloginventory_stock_item csi
    JOIN catalog_product_entity cpe ON cpe.entity_id = csi.product_id
    WHERE csi.qty < 10 AND csi.is_in_stock = 1
    ORDER BY csi.qty ASC
    LIMIT 100
  `,
  abandoned_carts: `
    SELECT entity_id, customer_email, grand_total, created_at, updated_at
    FROM quote
    WHERE is_active = 1
      AND customer_email IS NOT NULL
      AND items_count > 0
      AND updated_at < (NOW() - INTERVAL 1 DAY)
    ORDER BY updated_at DESC
    LIMIT 100
  `,
};

export function registerDbTools(server: McpServer): void {
  if (!config.db) {
    console.error("MAGENTO_DB_HOST not set — DB tools disabled, running REST/GraphQL-only.");
    return;
  }

  server.tool(
    "run_readonly_sql",
    "Execute a raw read-only SQL SELECT query directly against the live Magento MySQL database " +
      "for analytical insight not available via REST/GraphQL. The DB connection is SELECT-only " +
      "(no write grants), and queries are further restricted to a single SELECT statement with an " +
      "enforced row limit and timeout. Use this for ad-hoc reporting; prefer the prebuilt insight " +
      "tools (top_selling_products, low_stock_items, abandoned_carts) for common questions.",
    { sql: z.string().describe("A single SELECT statement") },
    async ({ sql }) => {
      try {
        const safeSql = assertSafeSelect(sql);
        const result = await runReadOnlyQuery(safeSql);
        return jsonResult(result);
      } catch (err) {
        if (err instanceof QueryRejectedError) {
          return errorResult(err.message);
        }
        throw err;
      }
    }
  );

  server.tool(
    "top_selling_products",
    "Prebuilt insight query: top 20 best-selling products by quantity ordered.",
    {},
    async () => jsonResult(await runReadOnlyQuery(PREBUILT_QUERIES.top_selling_products))
  );

  server.tool(
    "low_stock_items",
    "Prebuilt insight query: in-stock products with qty under 10, lowest first.",
    {},
    async () => jsonResult(await runReadOnlyQuery(PREBUILT_QUERIES.low_stock_items))
  );

  server.tool(
    "abandoned_carts",
    "Prebuilt insight query: active carts with items, belonging to a known customer email, untouched for over a day.",
    {},
    async () => jsonResult(await runReadOnlyQuery(PREBUILT_QUERIES.abandoned_carts))
  );
}
