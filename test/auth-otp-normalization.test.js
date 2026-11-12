const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizePhone } = require("../controllers/authOtpController");

test("authentication phone normalization supports Indian local and E.164 input", () => {
  assert.equal(normalizePhone("98765 43210"), "919876543210");
  assert.equal(normalizePhone("+91 (98765) 43210"), "919876543210");
  assert.equal(normalizePhone("+14155552671"), "14155552671");
  assert.equal(normalizePhone("12345"), null);
});
