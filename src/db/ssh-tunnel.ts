import { readFileSync } from "node:fs";
import net from "node:net";
import { Client } from "ssh2";
import type { SshTunnelConfig } from "../config.js";

export interface TunnelHandle {
  localPort: number;
  close: () => void;
}

/**
 * Opens a local TCP listener that forwards every connection through an SSH
 * connection to (destHost, destPort) as seen from the SSH host — i.e. a
 * standard "ssh -L" local port forward, done in-process instead of shelling
 * out. Used so MAGENTO_DB_HOST/PORT can be reached without exposing MySQL
 * directly to the machine running this server.
 */
export function openSshTunnel(
  sshConfig: SshTunnelConfig,
  destHost: string,
  destPort: number
): Promise<TunnelHandle> {
  return new Promise((resolve, reject) => {
    const conn = new Client();

    conn.on("ready", () => {
      const server = net.createServer((socket) => {
        conn.forwardOut(socket.remoteAddress ?? "127.0.0.1", socket.remotePort ?? 0, destHost, destPort, (err, stream) => {
          if (err) {
            socket.destroy();
            return;
          }
          socket.pipe(stream);
          stream.pipe(socket);
          stream.on("error", () => socket.destroy());
          socket.on("error", () => stream.destroy());
        });
      });

      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("SSH tunnel: failed to bind a local port"));
          return;
        }
        resolve({
          localPort: address.port,
          close: () => {
            server.close();
            conn.end();
          },
        });
      });

      server.on("error", (err) => {
        conn.end();
        reject(err);
      });
    });

    conn.on("error", (err) => {
      reject(new Error(`SSH tunnel to ${sshConfig.host}:${sshConfig.port} failed: ${err.message}`, { cause: err }));
    });

    conn.connect({
      host: sshConfig.host,
      port: sshConfig.port,
      username: sshConfig.username,
      password: sshConfig.password,
      privateKey: sshConfig.privateKeyPath ? readFileSync(sshConfig.privateKeyPath) : undefined,
      passphrase: sshConfig.passphrase,
    });
  });
}
