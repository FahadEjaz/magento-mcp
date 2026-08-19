import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { magentoClient, buildSearchCriteriaQuery } from "../magento/client.js";
import { ConfirmField, confirmPreview, jsonResult } from "./shared.js";

export function registerCustomerTools(server: McpServer): void {
  server.tool(
    "search_customers",
    "Search Magento customers by email (substring match), paginated.",
    {
      email: z.string().optional(),
      pageSize: z.number().int().min(1).max(100).default(20),
      currentPage: z.number().int().min(1).default(1),
    },
    async ({ email, pageSize, currentPage }) => {
      const filterGroups = email
        ? [{ filters: [{ field: "email", value: `%${email}%`, conditionType: "like" }] }]
        : [];
      const qs = buildSearchCriteriaQuery({ filterGroups, pageSize, currentPage });
      const result = await magentoClient.get(`/customers/search?${qs}`);
      return jsonResult(result);
    }
  );

  server.tool(
    "get_customer",
    "Get full details for a single Magento customer by ID.",
    { customerId: z.number().int() },
    async ({ customerId }) => {
      const result = await magentoClient.get(`/customers/${customerId}`);
      return jsonResult(result);
    }
  );

  server.tool(
    "update_customer",
    "Update fields on an existing Magento customer. " +
      "Requires confirm:true to actually execute; otherwise returns a preview.",
    {
      customerId: z.number().int(),
      updates: z.record(z.any()).describe("Partial customer fields, e.g. { firstname: 'Jane' }"),
      confirm: ConfirmField,
    },
    async ({ customerId, updates, confirm }) => {
      if (!confirm) {
        return confirmPreview(`update customer ${customerId}`, updates);
      }
      const result = await magentoClient.put(`/customers/${customerId}`, {
        // id spread last so it can't be silently overridden by a conflicting field in updates.
        customer: { ...updates, id: customerId },
      });
      return jsonResult(result);
    }
  );

  server.tool(
    "delete_customer",
    "Permanently delete a Magento customer by ID. " +
      "Requires confirm:true to actually execute; otherwise returns a preview.",
    { customerId: z.number().int(), confirm: ConfirmField },
    async ({ customerId, confirm }) => {
      if (!confirm) {
        return confirmPreview(`delete customer ${customerId}`, { customerId });
      }
      await magentoClient.delete(`/customers/${customerId}`);
      return jsonResult({ deleted: customerId });
    }
  );
}
