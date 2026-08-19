import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { magentoClient, buildSearchCriteriaQuery } from "../magento/client.js";
import { ConfirmField, confirmPreview, jsonResult } from "./shared.js";

export function registerCatalogTools(server: McpServer): void {
  server.tool(
    "search_products",
    "Search Magento products by SKU or name (substring match), paginated.",
    {
      query: z.string().describe("SKU or name substring to search for"),
      field: z.enum(["sku", "name"]).default("sku"),
      pageSize: z.number().int().min(1).max(100).default(20),
      currentPage: z.number().int().min(1).default(1),
    },
    async ({ query, field, pageSize, currentPage }) => {
      const qs = buildSearchCriteriaQuery({
        filterGroups: [{ filters: [{ field, value: `%${query}%`, conditionType: "like" }] }],
        pageSize,
        currentPage,
      });
      const result = await magentoClient.get(`/products?${qs}`);
      return jsonResult(result);
    }
  );

  server.tool(
    "get_product",
    "Get full details for a single Magento product by SKU.",
    { sku: z.string() },
    async ({ sku }) => {
      const result = await magentoClient.get(`/products/${encodeURIComponent(sku)}`);
      return jsonResult(result);
    }
  );

  server.tool(
    "update_product",
    "Update fields on an existing Magento product (e.g. price, status, name). " +
      "Requires confirm:true to actually execute; otherwise returns a preview.",
    {
      sku: z.string(),
      updates: z.record(z.any()).describe("Partial product fields to update, e.g. { price: 19.99 }"),
      confirm: ConfirmField,
    },
    async ({ sku, updates, confirm }) => {
      if (!confirm) {
        return confirmPreview(`update product "${sku}"`, updates);
      }
      const result = await magentoClient.put(`/products/${encodeURIComponent(sku)}`, {
        // sku spread last so it can't be silently overridden by a conflicting field in updates.
        product: { ...updates, sku },
      });
      return jsonResult(result);
    }
  );

  server.tool(
    "delete_product",
    "Permanently delete a Magento product by SKU. " +
      "Requires confirm:true to actually execute; otherwise returns a preview.",
    { sku: z.string(), confirm: ConfirmField },
    async ({ sku, confirm }) => {
      if (!confirm) {
        return confirmPreview(`delete product "${sku}"`, { sku });
      }
      await magentoClient.delete(`/products/${encodeURIComponent(sku)}`);
      return jsonResult({ deleted: sku });
    }
  );

  server.tool(
    "list_categories",
    "Get the full Magento category tree.",
    {},
    async () => {
      const result = await magentoClient.get(`/categories`);
      return jsonResult(result);
    }
  );
}
