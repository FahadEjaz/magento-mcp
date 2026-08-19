import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { magentoClient, buildSearchCriteriaQuery } from "../magento/client.js";
import { ConfirmField, confirmPreview, jsonResult } from "./shared.js";

export function registerInventoryTools(server: McpServer): void {
  server.tool(
    "get_stock_item",
    "Get legacy stock item (qty, is_in_stock) for a product SKU.",
    { sku: z.string() },
    async ({ sku }) => {
      const result = await magentoClient.get(`/stockItems/${encodeURIComponent(sku)}`);
      return jsonResult(result);
    }
  );

  server.tool(
    "list_source_items",
    "List MSI source items (per-warehouse stock) for a product SKU.",
    { sku: z.string() },
    async ({ sku }) => {
      const qs = buildSearchCriteriaQuery({ filterGroups: [{ filters: [{ field: "sku", value: sku }] }] });
      const result = await magentoClient.get(`/inventory/source-items?${qs}`);
      return jsonResult(result);
    }
  );

  server.tool(
    "update_stock_item",
    "Update legacy stock qty/is_in_stock for a product SKU. " +
      "Requires confirm:true to actually execute; otherwise returns a preview.",
    {
      sku: z.string(),
      itemId: z.number().int(),
      qty: z.number().optional(),
      isInStock: z.boolean().optional(),
      confirm: ConfirmField,
    },
    async ({ sku, itemId, qty, isInStock, confirm }) => {
      const updates = {
        ...(qty !== undefined ? { qty } : {}),
        ...(isInStock !== undefined ? { is_in_stock: isInStock } : {}),
      };
      if (!confirm) {
        return confirmPreview(`update stock item "${sku}"`, updates);
      }
      const result = await magentoClient.put(`/products/${encodeURIComponent(sku)}/stockItems/${itemId}`, {
        stockItem: updates,
      });
      return jsonResult(result);
    }
  );
}
