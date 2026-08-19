import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { magentoClient, buildSearchCriteriaQuery } from "../magento/client.js";
import { jsonResult } from "./shared.js";

export function registerCmsTools(server: McpServer): void {
  server.tool(
    "list_cms_pages",
    "List Magento CMS pages, paginated.",
    {
      pageSize: z.number().int().min(1).max(100).default(20),
      currentPage: z.number().int().min(1).default(1),
    },
    async ({ pageSize, currentPage }) => {
      const qs = buildSearchCriteriaQuery({ pageSize, currentPage });
      const result = await magentoClient.get(`/cmsPage/search?${qs}`);
      return jsonResult(result);
    }
  );

  server.tool(
    "get_cms_page",
    "Get a single Magento CMS page by ID, including content.",
    { pageId: z.number().int() },
    async ({ pageId }) => {
      const result = await magentoClient.get(`/cmsPage/${pageId}`);
      return jsonResult(result);
    }
  );

  server.tool(
    "list_cms_blocks",
    "List Magento CMS blocks, paginated.",
    {
      pageSize: z.number().int().min(1).max(100).default(20),
      currentPage: z.number().int().min(1).default(1),
    },
    async ({ pageSize, currentPage }) => {
      const qs = buildSearchCriteriaQuery({ pageSize, currentPage });
      const result = await magentoClient.get(`/cmsBlock/search?${qs}`);
      return jsonResult(result);
    }
  );
}
