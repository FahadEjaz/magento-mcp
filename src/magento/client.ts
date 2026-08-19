import { config } from "../config.js";
import { getOAuthHeader } from "./oauth.js";
import { MagentoApiError, type MagentoErrorBody, type SearchCriteria } from "./types.js";

export function buildSearchCriteriaQuery(criteria: SearchCriteria): string {
  const params = new URLSearchParams();

  criteria.filterGroups?.forEach((group, groupIndex) => {
    group.filters.forEach((filter, filterIndex) => {
      const prefix = `searchCriteria[filterGroups][${groupIndex}][filters][${filterIndex}]`;
      params.set(`${prefix}[field]`, filter.field);
      params.set(`${prefix}[value]`, String(filter.value));
      params.set(`${prefix}[conditionType]`, filter.conditionType ?? "eq");
    });
  });

  criteria.sortOrders?.forEach((sort, index) => {
    params.set(`searchCriteria[sortOrders][${index}][field]`, sort.field);
    params.set(`searchCriteria[sortOrders][${index}][direction]`, sort.direction);
  });

  if (criteria.pageSize !== undefined) {
    params.set("searchCriteria[pageSize]", String(criteria.pageSize));
  }
  if (criteria.currentPage !== undefined) {
    params.set("searchCriteria[currentPage]", String(criteria.currentPage));
  }

  return params.toString();
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${config.magento.baseUrl}/rest/V1${path}`;
  const method = init.method ?? "GET";

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        ...init.headers,
        // OAuth 1.0a signs method+URL(+query string); the JSON body is not
        // part of the signature, matching Magento's own OAuth1 REST auth.
        ...getOAuthHeader(url, method),
        "Content-Type": "application/json",
      },
    });
  } catch (cause) {
    throw new Error(
      `Could not reach Magento at ${config.magento.baseUrl} (request to ${url} failed). ` +
        `Check the store/site is up and MAGENTO_BASE_URL is correct.`,
      { cause }
    );
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({ message: response.statusText }))) as MagentoErrorBody;
    throw new MagentoApiError(
      response.status,
      body.message ?? "Magento API request failed",
      body.parameters
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const magentoClient = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
