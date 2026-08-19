import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { magentoClient } from "../magento/client.js";

export function registerStoreInfoResource(server: McpServer): void {
  server.resource(
    "store-config",
    "magento://store/config",
    { description: "Magento store configuration: currencies, locales, store views, base URLs." },
    async (uri) => {
      const storeConfigs = await magentoClient.get(`/store/storeConfigs`);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(storeConfigs, null, 2),
          },
        ],
      };
    }
  );
}
