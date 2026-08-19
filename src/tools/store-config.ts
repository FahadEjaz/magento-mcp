import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { magentoClient } from "../magento/client.js";
import { ConfirmField, confirmPreview, jsonResult } from "./shared.js";

export function registerStoreConfigTools(server: McpServer): void {
  server.tool(
    "get_store_config",
    "Get Magento store configuration (currencies, locales, store views) for all websites/stores.",
    {},
    async () => {
      const result = await magentoClient.get(`/store/storeConfigs`);
      return jsonResult(result);
    }
  );

  server.tool(
    "list_store_views",
    "List Magento store views.",
    {},
    async () => {
      const result = await magentoClient.get(`/store/storeViews`);
      return jsonResult(result);
    }
  );

  server.tool(
    "set_config_value",
    "Set a Magento core config value (system configuration path, e.g. 'general/locale/timezone'). " +
      "This is a broad, sensitive capability — requires confirm:true to actually execute; otherwise returns a preview.",
    {
      path: z.string().describe("Config path, e.g. 'general/locale/timezone'"),
      value: z.string(),
      scope: z.enum(["default", "websites", "stores"]).default("default"),
      scopeId: z.number().int().default(0),
      confirm: ConfirmField,
    },
    async ({ path, value, scope, scopeId, confirm }) => {
      const details = { path, value, scope, scopeId };
      if (!confirm) {
        return confirmPreview(`set config value "${path}"`, details);
      }
      const result = await magentoClient.post(`/config`, {
        configData: { path, value, scope, scope_id: scopeId },
      });
      return jsonResult(result);
    }
  );
}
