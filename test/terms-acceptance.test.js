const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const TermsAcceptance = require("../models/termsAcceptance");
const termsController = require("../controllers/termsController");
const {
  normalizeRole,
  getCurrentTerms,
  acceptanceTokenHash,
} = require("../services/termsAcceptanceService");

test("current terms API documents are separate and role-specific", () => {
  const expected = {
    patient: "patient_individual",
    doctor: "doctor_partner",
    laboratory: "laboratory_partner",
    pharmacy: "pharmacy_partner",
  };
  for (const [role, documentType] of Object.entries(expected)) {
    const terms = getCurrentTerms(role);
    assert.equal(terms.role, role);
    assert.equal(terms.documentType, documentType);
    assert.match(terms.title, /HealthHome/);
    assert.match(terms.content, /^1\. /);
    assert.equal(terms.version, "2.0.0");
    assert.ok(terms.metadata.length >= 4);
    assert.equal(terms.contentHash, crypto.createHash("sha256").update(JSON.stringify({
      title: terms.title,
      metadata: terms.metadata,
      content: terms.content,
    }), "utf8").digest("hex"));
  }
  assert.equal(getCurrentTerms("admin"), null);
});

test("role normalization maps only the laboratory alias to the lab document", () => {
  assert.equal(normalizeRole(" LAB "), "laboratory");
  assert.equal(getCurrentTerms("lab").documentType, "laboratory_partner");
  assert.equal(getCurrentTerms("doctor").documentType, "doctor_partner");
});

test("acceptance tokens are stored as one-way SHA-256 hashes", () => {
  const token = "random-acceptance-token-with-sufficient-length";
  const hash = acceptanceTokenHash(token);
  assert.equal(hash, crypto.createHash("sha256").update(token).digest("hex"));
  assert.notEqual(hash, token);
  assert.equal(acceptanceTokenHash("short"), null);
});

test("acceptance endpoint refuses an incomplete or unchecked attestation", async () => {
  const response = await callController(termsController.accept, {
    selectedRole: "doctor",
    termsDocumentType: "doctor_partner",
    termsVersion: "1.0.0",
    termsContentHash: getCurrentTerms("doctor").contentHash,
    accepted: false,
    readToEnd: true,
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
});

test("acceptance endpoint rejects a document belonging to a different role", async () => {
  const response = await callController(termsController.accept, {
    selectedRole: "doctor",
    termsDocumentType: "patient_individual",
    termsVersion: "1.0.0",
    termsContentHash: getCurrentTerms("patient").contentHash,
    accepted: true,
    readToEnd: true,
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.code, "TERMS_VERSION_MISMATCH");
});

test("acceptance endpoint rejects an unsupported role", async () => {
  const response = await callController(termsController.accept, {
    selectedRole: "administrator",
    termsDocumentType: "patient_individual",
    termsVersion: "1.0.0",
    termsContentHash: getCurrentTerms("patient").contentHash,
    onboardingSessionToken: "A".repeat(43),
    accepted: true,
    readToEnd: true,
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.success, false);
});

test("acceptance endpoint requires an opaque onboarding session", async () => {
  const terms = getCurrentTerms("patient");
  const response = await callController(termsController.accept, {
    selectedRole: "patient",
    termsDocumentType: terms.documentType,
    termsVersion: terms.version,
    termsContentHash: terms.contentHash,
    accepted: true,
    readToEnd: true,
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
});

test("acceptance endpoint stores the exact current role, version and content hash", async () => {
  const terms = getCurrentTerms("pharmacy");
  const originalCreate = TermsAcceptance.create;
  const originalFindOne = TermsAcceptance.findOne;
  const sessionToken = "P".repeat(43);
  let record;
  TermsAcceptance.findOne = () => ({ select: async () => null });
  TermsAcceptance.create = async (data) => {
    record = data;
    return data;
  };
  try {
    const response = await callController(termsController.accept, {
      selectedRole: "pharmacy",
      termsDocumentType: terms.documentType,
      termsVersion: terms.version,
      termsContentHash: terms.contentHash,
      onboardingSessionToken: sessionToken,
      accepted: true,
      readToEnd: true,
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.success, true);
    assert.equal(record.selectedRole, "pharmacy");
    assert.equal(record.termsDocumentType, terms.documentType);
    assert.equal(record.termsVersion, terms.version);
    assert.equal(record.termsContentHash, terms.contentHash);
    assert.deepEqual(record.documentMetadata, terms.metadata);
    assert.deepEqual(record.businessDetails, terms.businessDetails);
    assert.deepEqual(record.policyVersion, terms.policyVersion);
    assert.equal(record.acceptanceTokenHash, acceptanceTokenHash(sessionToken));
    assert.equal(response.body.acceptanceToken, sessionToken);
    assert.equal(record.userId, undefined);
  } finally {
    TermsAcceptance.create = originalCreate;
    TermsAcceptance.findOne = originalFindOne;
  }
});

test("acceptance retry with the same onboarding session is idempotent", async () => {
  const terms = getCurrentTerms("doctor");
  const sessionToken = "D".repeat(43);
  const existing = {
    selectedRole: "doctor",
    termsDocumentType: terms.documentType,
    termsVersion: terms.version,
    termsContentHash: terms.contentHash,
    acceptanceStatus: "ACCEPTED",
    acceptedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  };
  const originalFindOne = TermsAcceptance.findOne;
  const originalCreate = TermsAcceptance.create;
  TermsAcceptance.findOne = () => ({ select: async () => existing });
  TermsAcceptance.create = async () => { throw new Error("duplicate record created"); };
  try {
    const response = await callController(termsController.accept, {
      selectedRole: "doctor",
      termsDocumentType: terms.documentType,
      termsVersion: terms.version,
      termsContentHash: terms.contentHash,
      onboardingSessionToken: sessionToken,
      accepted: true,
      readToEnd: true,
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.alreadyAccepted, true);
    assert.equal(response.body.acceptanceToken, sessionToken);
  } finally {
    TermsAcceptance.findOne = originalFindOne;
    TermsAcceptance.create = originalCreate;
  }
});

test("acceptance endpoint refuses an expired onboarding session", async () => {
  const terms = getCurrentTerms("laboratory");
  const sessionToken = "L".repeat(43);
  const existing = {
    selectedRole: "laboratory",
    termsDocumentType: terms.documentType,
    termsVersion: terms.version,
    termsContentHash: terms.contentHash,
    acceptanceStatus: "ACCEPTED",
    acceptedAt: new Date(Date.now() - 60_000),
    expiresAt: new Date(Date.now() - 1),
  };
  const originalFindOne = TermsAcceptance.findOne;
  TermsAcceptance.findOne = () => ({ select: async () => existing });
  try {
    const response = await callController(termsController.accept, {
      selectedRole: "laboratory",
      termsDocumentType: terms.documentType,
      termsVersion: terms.version,
      termsContentHash: terms.contentHash,
      onboardingSessionToken: sessionToken,
      accepted: true,
      readToEnd: true,
    });
    assert.equal(response.status, 410);
    assert.equal(response.body.code, "ONBOARDING_SESSION_EXPIRED");
  } finally {
    TermsAcceptance.findOne = originalFindOne;
  }
});

async function callController(controller, body) {
  const response = {
    status: 200,
    body: null,
    status(code) {
      this.status = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
  await controller({ body, ip: "terms-test-ip" }, response);
  return response;
}
