import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { BackendError } from "../src/backend/Backend";
import { HttpBackend } from "../src/backend/HttpBackend";

describe("HttpBackend", () => {
  let server: Server;

  afterEach(async () => {
    if (!server.listening) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("reads a user, treats 404 as null, and throws on other errors", async () => {
    server = createServer((req, res) => {
      if (req.url === `/users/by-phone/${encodeURIComponent("+15550000001")}`) {
        res.end(JSON.stringify({ id: "maya", name: "Maya Chen", phone: "+15550000001", suggestible: true }));
        return;
      }
      if (req.url?.startsWith("/users/by-phone/")) {
        res.statusCode = 404;
        res.end("missing");
        return;
      }
      res.statusCode = 502;
      res.end("upstream down");
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;
    const backend = new HttpBackend(`http://127.0.0.1:${port}`);

    await expect(backend.getUserByPhone("+15550000001")).resolves.toMatchObject({ id: "maya" });
    await expect(backend.getUserByPhone("+15550000999")).resolves.toBeNull();
    await expect(backend.getClub("ysig")).rejects.toBeInstanceOf(BackendError);
  });
});