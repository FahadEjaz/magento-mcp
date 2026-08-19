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

export const config = {
  magento: {
    baseUrl: required("MAGENTO_BASE_URL").replace(/\/+$/, ""),
    consumerKey: required("MAGENTO_CONSUMER_KEY"),
    consumerSecret: required("MAGENTO_CONSUMER_SECRET"),
    accessToken: required("MAGENTO_ACCESS_TOKEN"),
    accessTokenSecret: required("MAGENTO_ACCESS_TOKEN_SECRET"),
  },
  db: {
    host: required("MAGENTO_DB_HOST"),
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
  },
};
