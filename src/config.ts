import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export interface SshTunnelConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
}

function buildSshConfig(): SshTunnelConfig | null {
  const host = process.env.MAGENTO_DB_SSH_HOST;
  if (!host) {
    return null;
  }

  const password = process.env.MAGENTO_DB_SSH_PASSWORD;
  const privateKeyPath = process.env.MAGENTO_DB_SSH_PRIVATE_KEY_PATH;
  if (!password && !privateKeyPath) {
    throw new Error(
      "MAGENTO_DB_SSH_HOST is set but neither MAGENTO_DB_SSH_PASSWORD nor " +
        "MAGENTO_DB_SSH_PRIVATE_KEY_PATH is — one is required to authenticate the SSH tunnel."
    );
  }

  return {
    host,
    port: Number(process.env.MAGENTO_DB_SSH_PORT ?? 22),
    username: required("MAGENTO_DB_SSH_USER"),
    password,
    privateKeyPath,
    passphrase: process.env.MAGENTO_DB_SSH_PASSPHRASE,
  };
}

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  queryTimeoutMs: number;
  maxRows: number;
  poolSize: number;
  ssh: SshTunnelConfig | null;
}

function buildDbConfig(): DbConfig | null {
  const host = process.env.MAGENTO_DB_HOST;
  if (!host) {
    return null;
  }

  return {
    host,
    port: Number(process.env.MAGENTO_DB_PORT ?? 3306),
    database: required("MAGENTO_DB_NAME"),
    user: required("MAGENTO_DB_READONLY_USER"),
    password: required("MAGENTO_DB_READONLY_PASSWORD"),
    queryTimeoutMs: Number(process.env.MAGENTO_DB_QUERY_TIMEOUT_MS ?? 5000),
    maxRows: Number(process.env.MAGENTO_DB_MAX_ROWS ?? 500),
    poolSize: Number(process.env.MAGENTO_DB_POOL_SIZE ?? 3),
    // If set, MAGENTO_DB_HOST/PORT above are reached THROUGH this SSH tunnel
    // (i.e. as seen from the SSH host) instead of connected to directly.
    ssh: buildSshConfig(),
  };
}

export type OAuthSignatureMethod = "HMAC-SHA1" | "HMAC-SHA256";

function buildOAuthSignatureMethod(): OAuthSignatureMethod {
  const value = process.env.MAGENTO_OAUTH_SIGNATURE_METHOD ?? "HMAC-SHA1";
  if (value !== "HMAC-SHA1" && value !== "HMAC-SHA256") {
    throw new Error(
      `Invalid MAGENTO_OAUTH_SIGNATURE_METHOD: "${value}" — must be "HMAC-SHA1" or "HMAC-SHA256" ` +
        `(check Magento Admin > System > Integrations, or Stores > Configuration > Services > OAuth, for which one this instance requires).`
    );
  }
  return value;
}

export const config = {
  magento: {
    baseUrl: required("MAGENTO_BASE_URL").replace(/\/+$/, ""),
    consumerKey: required("MAGENTO_CONSUMER_KEY"),
    consumerSecret: required("MAGENTO_CONSUMER_SECRET"),
    accessToken: required("MAGENTO_ACCESS_TOKEN"),
    accessTokenSecret: required("MAGENTO_ACCESS_TOKEN_SECRET"),
    // Magento instances vary on which OAuth1 signature method they accept —
    // recent versions commonly require HMAC-SHA256, older ones HMAC-SHA1.
    oauthSignatureMethod: buildOAuthSignatureMethod(),
  },
  // null when MAGENTO_DB_HOST is unset — REST/GraphQL-only mode, DB tools disabled.
  db: buildDbConfig(),
};
