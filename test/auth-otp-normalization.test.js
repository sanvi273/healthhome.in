const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizePhone, msg91, verifyWidgetAccessToken, loginWithPassword } = require("../controllers/authOtpController");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/user");
const TermsAcceptance = require("../models/termsAcceptance");

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

test("MSG91 Widget access-token validation sends Auth Key in the documented header", async () => {
  const originalFetch = global.fetch;
  const originalAuthKey = process.env.MSG91_AUTH_KEY;
  let captured;
  process.env.MSG91_AUTH_KEY = "unit-test-auth-key";
  global.fetch = async (url, options) => {
    captured = { url, options };
    return { ok: true, status: 200, json: async () => ({ type: "success", identifier: "919876543210" }) };
  };
  try {
    const result = await verifyWidgetAccessToken("unit-test-access-token");
    assert.equal(result.type, "success");
    assert.match(captured.url, /\/widget\/verifyAccessToken$/);
    assert.equal(captured.options.headers.authkey, "unit-test-auth-key");
    assert.equal(new URLSearchParams(captured.options.body).get("access-token"), "unit-test-access-token");
    assert.equal(new URLSearchParams(captured.options.body).has("authkey"), false);
  } finally {
    global.fetch = originalFetch;
    if (originalAuthKey === undefined) delete process.env.MSG91_AUTH_KEY;
    else process.env.MSG91_AUTH_KEY = originalAuthKey;
  }
});

test("password login returns a session after password and current terms checks without OTP", async () => {
  const originals = {
    findOne: User.findOne,
    compare: bcrypt.compare,
    exists: TermsAcceptance.exists,
    sign: jwt.sign,
    secret: process.env.JWT_SECRET,
  };
  const user = {
    _id: "user-123",
    name: "Test Patient",
    email: "patient@example.test",
    role: "patient",
    phone: "9876543210",
    password: "hashed-password",
    accountStatus: "ACTIVE",
    verificationStatus: "NOT_REQUIRED",
    addresses: [],
  };
  let query;
  User.findOne = async (value) => { query = value; return user; };
  bcrypt.compare = async (password, hash) => password === "correct-password" && hash === "hashed-password";
  TermsAcceptance.exists = async () => true;
  jwt.sign = () => "test-jwt";
  process.env.JWT_SECRET = "test-secret";

  try {
    const response = await callLogin({ phone: "9876543210", password: "correct-password", role: "patient" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.token, "test-jwt");
    assert.equal(response.body.user.role, "patient");
    assert.deepEqual(query, { phone: { $in: ["919876543210", "+919876543210", "9876543210"] }, role: "patient" });
  } finally {
    User.findOne = originals.findOne;
    bcrypt.compare = originals.compare;
    TermsAcceptance.exists = originals.exists;
    jwt.sign = originals.sign;
    if (originals.secret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originals.secret;
  }
});

async function callLogin(body) {
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  await loginWithPassword({ body, ip: `password-login-test-${Date.now()}-${Math.random()}` }, response);
  return response;
}
