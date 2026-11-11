import assert from "node:assert/strict";
import test from "node:test";
import { notificationMailConfig, notificationMessageId } from "./notification-mail.mjs";

test("notification SMTP requires explicit host and trusted app origin", () => {
  assert.equal(notificationMailConfig({}).reason, "smtp_unconfigured");
  assert.equal(notificationMailConfig({ SMTP_HOST: "smtp.test" }).reason, "app_url_unconfigured");
  for (const APP_URL of ["file:///tmp/test", "https://user:secret@example.test", "invalid"]) {
    assert.equal(notificationMailConfig({ SMTP_HOST: "smtp.test", APP_URL }).configured, false);
  }
  for (const SMTP_PORT of ["0", "65536", "x", "1.5"]) {
    assert.equal(notificationMailConfig({ SMTP_HOST: "smtp.test", APP_URL: "https://atlas.test", SMTP_PORT }).reason, "smtp_invalid_port");
  }
  const config = notificationMailConfig({ SMTP_HOST: "smtp.test", APP_URL: "https://atlas.test/base", SMTP_PORT: "465" });
  assert.equal(config.appUrl, "https://atlas.test");
  assert.equal(config.configured, true);
  assert.equal(config.smtp.secure, true);
  assert.equal(notificationMessageId(12, 34), notificationMessageId(12, 34));
  assert.notEqual(notificationMessageId(12, 34), notificationMessageId(12, 35));
});
