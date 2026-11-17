import { describe, expect, it } from "vitest";
import { smsLink } from "../src/util/smsLink";

describe("smsLink", () => {
  it("encodes spaces, apostrophes, and ampersands with encodeURIComponent", () => {
    expect(smsLink("+15550000002", "hello world")).toBe("sms:+15550000002&body=hello%20world");
    expect(smsLink("+15550000002", "it's a start")).toBe(
      `sms:+15550000002&body=${encodeURIComponent("it's a start")}`,
    );
    expect(smsLink("+15550000002", "rock & roll")).toBe("sms:+15550000002&body=rock%20%26%20roll");
  });
});
