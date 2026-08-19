import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerCatalogTools } from "./tools/catalog.js";
import { registerOrderTools } from "./tools/orders.js";
import { registerCustomerTools } from "./tools/customers.js";
import { registerCmsTools } from "./tools/cms.js";
import { registerInventoryTools } from "./tools/inventory.js";
import { registerPromotionTools } from "./tools/promotions.js";
import { registerStoreConfigTools } from "./tools/store-config.js";
import { registerGraphqlCatalogTools } from "./tools/graphql-catalog.js";
import { registerDbTools } from "./tools/db-query.js";
import { registerStoreInfoResource } from "./resources/store-info.js";

const server = new McpServer({
  name: "magento-mcp",
  version: "0.1.0",
});

registerCatalogTools(server);
registerOrderTools(server);
registerCustomerTools(server);
registerCmsTools(server);
registerInventoryTools(server);
registerPromotionTools(server);
registerStoreConfigTools(server);
registerGraphqlCatalogTools(server);
registerDbTools(server);
registerStoreInfoResource(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("magento-mcp server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting magento-mcp server:", err);
  process.exit(1);
});
