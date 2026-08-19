export interface MagentoErrorBody {
  message: string;
  parameters?: Record<string, unknown> | unknown[];
}

export class MagentoApiError extends Error {
  status: number;
  parameters?: unknown;

  constructor(status: number, message: string, parameters?: unknown) {
    super(message);
    this.name = "MagentoApiError";
    this.status = status;
    this.parameters = parameters;
  }
}

export interface SearchCriteria {
  filterGroups?: Array<{
    filters: Array<{ field: string; value: string | number; conditionType?: string }>;
  }>;
  pageSize?: number;
  currentPage?: number;
  sortOrders?: Array<{ field: string; direction: "ASC" | "DESC" }>;
}
