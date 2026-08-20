import { config } from "../config.js";
import { getOAuthHeader } from "./oauth.js";
import { MagentoApiError, type MagentoErrorBody, type SearchCriteria } from "./types.js";

export function buildSearchCriteriaQuery(criteria: SearchCriteria): string {
  // oauth-1.0a's deParam() percent-decodes query VALUES but not KEYS (see
  // node_modules/oauth-1.0a/oauth-1.0a.js), so a URLSearchParams-encoded key
  // like `searchCriteria%5BpageSize%5D` gets double-encoded into the OAuth1
  // signature base string and Magento rejects the signature. Keep keys as
  // literal `[`/`]` (valid in a query string either way) and only
  // percent-encode values, so the key oauth-1.0a extracts from the URL
  // matches the literal key we built it from.
  const pairs: string[] = [];
  const set = (key: string, value: string) => pairs.push(`${key}=${encodeURIComponent(value)}`);

  criteria.filterGroups?.forEach((group, groupIndex) => {
    group.filters.forEach((filter, filterIndex) => {
      const prefix = `searchCriteria[filterGroups][${groupIndex}][filters][${filterIndex}]`;
      set(`${prefix}[field]`, filter.field);
      set(`${prefix}[value]`, String(filter.value));
      set(`${prefix}[conditionType]`, filter.conditionType ?? "eq");
    });
  });

  criteria.sortOrders?.forEach((sort, index) => {
    set(`searchCriteria[sortOrders][${index}][field]`, sort.field);
    set(`searchCriteria[sortOrders][${index}][direction]`, sort.direction);
  });

  if (criteria.pageSize !== undefined) {
    set("searchCriteria[pageSize]", String(criteria.pageSize));
  }
  if (criteria.currentPage !== undefined) {
    set("searchCriteria[currentPage]", String(criteria.currentPage));
  }

  return pairs.join("&");
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
