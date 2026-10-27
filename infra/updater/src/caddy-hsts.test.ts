import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const composeDir = path.resolve(import.meta.dirname, "../../compose");
const caddyfiles = ["Caddyfile.prod", "Caddyfile.cloudflare.example"];

describe.each(caddyfiles)("%s HSTS", (filename) => {
  const config = readFileSync(path.join(composeDir, filename), "utf8");
  const httpsSite = config.slice(config.lastIndexOf("{$RAKAZO_HOST:app.example.com} {"));

  it("sends HSTS from the HTTPS site without preloading", () => {
    expect(httpsSite).toContain('header @hsts Strict-Transport-Security "max-age=31536000"');
    expect(config).not.toContain("preload");
  });

  it("never pins HTTPS onto localhost", () => {
    expect(httpsSite).toContain("@hsts not host localhost 127.0.0.1");
  });

  it("stops other sites framing the app and sniffing responses", () => {
    expect(httpsSite).toContain("X-Content-Type-Options nosniff");
    expect(httpsSite).toContain("X-Frame-Options SAMEORIGIN");
    expect(httpsSite).not.toContain("frame-ancestors 'none'");
  });

  it("drops X-Frame-Options when RAKAZO_CSP_FRAME_ANCESTORS lets another site embed the app", () => {
    expect(httpsSite).toContain('@unframed expression `"{$RAKAZO_CSP_FRAME_ANCESTORS:}" == ""`');
    expect(httpsSite).toContain("header @unframed X-Frame-Options SAMEORIGIN");
    expect(httpsSite).not.toMatch(/^\t\tX-Frame-Options/m);
  });

  it("replaces the client-supplied forwarding header on API and RPC requests", () => {
    expect(httpsSite.match(/header_up X-Forwarded-For \{client_ip\}/g)).toHaveLength(2);
    expect(httpsSite).not.toContain("{remote_host}");
  });
});
