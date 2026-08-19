import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { graphqlClient } from "../graphql/client.js";
import { jsonResult } from "./shared.js";

const PRODUCT_DETAILS_QUERY = `
  query GetProductDetails($sku: String!) {
    products(filter: { sku: { eq: $sku } }) {
      items {
        sku
        name
        price_range {
          minimum_price {
            regular_price { value currency }
            final_price { value currency }
          }
        }
        description { html }
        short_description { html }
        image { url label }
        categories { id name url_path }
      }
    }
  }
`;

const CATALOG_SEARCH_QUERY = `
  query SearchCatalog($search: String!, $pageSize: Int!, $currentPage: Int!) {
    products(search: $search, pageSize: $pageSize, currentPage: $currentPage) {
      total_count
      items {
        sku
        name
        price_range {
          minimum_price {
            final_price { value currency }
          }
        }
      }
    }
  }
`;

const CATEGORY_TREE_QUERY = `
  query GetCategoryTree($id: Int!) {
    categories(filters: { ids: { eq: $id } }) {
      items {
        id
        name
        url_path
        children {
          id
          name
          url_path
          product_count
        }
      }
    }
  }
`;

export function registerGraphqlCatalogTools(server: McpServer): void {
  server.tool(
    "search_catalog",
    "Full-text search the Magento storefront catalog via GraphQL (name/description match, ranked).",
    {
      search: z.string(),
      pageSize: z.number().int().min(1).max(50).default(10),
      currentPage: z.number().int().min(1).default(1),
    },
    async ({ search, pageSize, currentPage }) => {
      const result = await graphqlClient.request(CATALOG_SEARCH_QUERY, { search, pageSize, currentPage });
      return jsonResult(result);
    }
  );

  server.tool(
    "get_product_details",
    "Get storefront-facing product details (price, description, images, categories) via GraphQL.",
    { sku: z.string() },
    async ({ sku }) => {
      const result = await graphqlClient.request(PRODUCT_DETAILS_QUERY, { sku });
      return jsonResult(result);
    }
  );

  server.tool(
    "get_category_tree",
    "Get a category and its immediate children via GraphQL. Use category ID 2 for the root category.",
    { categoryId: z.number().int().default(2) },
    async ({ categoryId }) => {
      const result = await graphqlClient.request(CATEGORY_TREE_QUERY, { id: categoryId });
      return jsonResult(result);
    }
  );
}
