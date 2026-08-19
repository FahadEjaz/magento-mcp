import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

class FakeClient extends EventEmitter {
  connect = vi.fn(() => {
    // Defer so callers can attach listeners before we emit.
    queueMicrotask(() => this.emit("ready"));
  });
  forwardOut = vi.fn((_srcIp, _srcPort, _dstHost, _dstPort, cb) => {
    cb(null, new PassThrough());
  });
  end = vi.fn();
}

let lastClient: FakeClient;

vi.mock("ssh2", () => ({
  Client: vi.fn(() => {
    lastClient = new FakeClient();
    return lastClient;
  }),
}));

const { openSshTunnel } = await import("./ssh-tunnel.js");

describe("openSshTunnel", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("resolves with a local forwarded port once the SSH connection is ready", async () => {
    const handle = await openSshTunnel(
      { host: "bastion.example.com", port: 22, username: "deploy", password: "hunter2" },
      "10.0.0.5",
      3306
    );

    expect(handle.localPort).toBeGreaterThan(0);
    expect(lastClient.connect).toHaveBeenCalledWith(
      expect.objectContaining({ host: "bastion.example.com", port: 22, username: "deploy", password: "hunter2" })
    );

    handle.close();
  });

  it("forwards a connection through to the configured destination host/port", async () => {
    const net = await import("node:net");
    const handle = await openSshTunnel(
      { host: "bastion.example.com", port: 22, username: "deploy", password: "hunter2" },
      "10.0.0.5",
      3306
    );

    await new Promise<void>((resolve, reject) => {
      const socket = net.connect(handle.localPort, "127.0.0.1", () => {
        socket.end();
        resolve();
      });
      socket.on("error", reject);
    });

    expect(lastClient.forwardOut).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Number),
      "10.0.0.5",
      3306,
      expect.any(Function)
    );

    handle.close();
  });

  it("rejects when the SSH connection itself errors", async () => {
    vi.doMock("ssh2", () => ({
      Client: vi.fn(() => {
        const client = new EventEmitter() as unknown as FakeClient;
        client.connect = vi.fn(() => {
          queueMicrotask(() => client.emit("error", new Error("auth failed")));
        });
        return client;
      }),
    }));
    vi.resetModules();
    const { openSshTunnel: freshOpenSshTunnel } = await import("./ssh-tunnel.js");

    await expect(
      freshOpenSshTunnel({ host: "bastion.example.com", port: 22, username: "deploy", password: "wrong" }, "10.0.0.5", 3306)
    ).rejects.toThrow(/SSH tunnel to bastion.example.com:22 failed/);

    vi.doUnmock("ssh2");
  });
});
