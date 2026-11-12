const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizePhone, msg91 } = require("../controllers/authOtpController");

test("authentication phone normalization supports Indian local and E.164 input", () => {
  assert.equal(normalizePhone("98765 43210"), "919876543210");
  assert.equal(normalizePhone("+91 (98765) 43210"), "919876543210");
  assert.equal(normalizePhone("+14155552671"), "14155552671");
  assert.equal(normalizePhone("12345"), null);
});

test("MSG91 Widget requests use the existing backend Auth Key, not a missing extra setting", async () => {
  const originalFetch = global.fetch;
  const originalAuthKey = process.env.MSG91_AUTH_KEY;
  const originalWidgetId = process.env.MSG91_WIDGET_ID;
  let captured;
  process.env.MSG91_AUTH_KEY = "unit-test-auth-key";
  process.env.MSG91_WIDGET_ID = "unit-test-widget-id";
  global.fetch = async (url, options) => {
    captured = { url, options };
    return { ok: true, status: 200, json: async () => ({ type: "success", message: "request-id" }) };
  };
  try {
    const response = await msg91("sendOtp", { identifier: "919876543210" });
    assert.equal(response.type, "success");
    assert.match(captured.url, /\/widget\/sendOtp$/);
    assert.equal(captured.options.headers.authkey, "unit-test-auth-key");
    assert.equal(captured.options.headers.tokenAuth, undefined);
    assert.deepEqual(JSON.parse(captured.options.body), {
      widgetId: "unit-test-widget-id",
      identifier: "919876543210",
    });
  } finally {
    global.fetch = originalFetch;
    if (originalAuthKey === undefined) delete process.env.MSG91_AUTH_KEY;
    else process.env.MSG91_AUTH_KEY = originalAuthKey;
    if (originalWidgetId === undefined) delete process.env.MSG91_WIDGET_ID;
    else process.env.MSG91_WIDGET_ID = originalWidgetId;
  }
});
