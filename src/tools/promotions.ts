import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { magentoClient, buildSearchCriteriaQuery } from "../magento/client.js";
import { jsonResult } from "./shared.js";

export function registerPromotionTools(server: McpServer): void {
  server.tool(
    "list_cart_price_rules",
    "Search Magento cart price rules (promotions), paginated.",
    {
      pageSize: z.number().int().min(1).max(100).default(20),
      currentPage: z.number().int().min(1).default(1),
    },
    async ({ pageSize, currentPage }) => {
      const qs = buildSearchCriteriaQuery({ pageSize, currentPage });
      const result = await magentoClient.get(`/salesRules/search?${qs}`);
      return jsonResult(result);
    }
  );

  server.tool(
    "get_coupon_by_code",
    "Look up a Magento coupon by its code.",
    { code: z.string() },
    async ({ code }) => {
      const qs = buildSearchCriteriaQuery({
        filterGroups: [{ filters: [{ field: "code", value: code }] }],
      });
      const result = await magentoClient.get(`/coupons/search?${qs}`);
      return jsonResult(result);
    }
  );
}
