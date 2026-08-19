import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { magentoClient, buildSearchCriteriaQuery } from "../magento/client.js";
import { ConfirmField, confirmPreview, jsonResult } from "./shared.js";

export function registerOrderTools(server: McpServer): void {
  server.tool(
    "search_orders",
    "Search Magento orders by status, email, or increment ID, paginated.",
    {
      status: z.string().optional().describe("Order status, e.g. 'processing', 'complete', 'canceled'"),
      customerEmail: z.string().optional(),
      incrementId: z.string().optional(),
      pageSize: z.number().int().min(1).max(100).default(20),
      currentPage: z.number().int().min(1).default(1),
    },
    async ({ status, customerEmail, incrementId, pageSize, currentPage }) => {
      const filters = [];
      if (status) filters.push({ field: "status", value: status });
      if (customerEmail) filters.push({ field: "customer_email", value: customerEmail });
      if (incrementId) filters.push({ field: "increment_id", value: incrementId });

      const qs = buildSearchCriteriaQuery({
        filterGroups: filters.map((f) => ({ filters: [f] })),
        pageSize,
        currentPage,
      });
      const result = await magentoClient.get(`/orders?${qs}`);
      return jsonResult(result);
    }
  );

  server.tool(
    "get_order",
    "Get full details for a single Magento order by entity ID.",
    { orderId: z.number().int() },
    async ({ orderId }) => {
      const result = await magentoClient.get(`/orders/${orderId}`);
      return jsonResult(result);
    }
  );

  server.tool(
    "cancel_order",
    "Cancel a Magento order. Requires confirm:true to actually execute; otherwise returns a preview.",
    { orderId: z.number().int(), confirm: ConfirmField },
    async ({ orderId, confirm }) => {
      if (!confirm) {
        return confirmPreview(`cancel order ${orderId}`, { orderId });
      }
      const result = await magentoClient.post(`/orders/${orderId}/cancel`);
      return jsonResult(result);
    }
  );

  server.tool(
    "refund_order",
    "Issue an offline refund for a Magento order invoice. " +
      "Requires confirm:true to actually execute; otherwise returns a preview.",
    {
      invoiceId: z.number().int(),
      confirm: ConfirmField,
    },
    async ({ invoiceId, confirm }) => {
      if (!confirm) {
        return confirmPreview(`refund invoice ${invoiceId}`, { invoiceId });
      }
      const result = await magentoClient.post(`/invoice/${invoiceId}/refund`, {});
      return jsonResult(result);
    }
  );
}
