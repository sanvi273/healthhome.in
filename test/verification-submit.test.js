const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const invoke = async (handler, request) => {
  let statusCode;
  let body;
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; },
  };
  await handler(request, res);
  return { statusCode, body };
};

test("verification submission saves entered details and keeps uploaded documents for admin review", async () => {
  const user = {
    _id: "user-1",
    name: "Chaudhary Lab",
    role: "laboratory",
    verificationStatus: "PENDING",
    async save() { this.saved = true; },
  };
  const verification = {
    userId: "user-1",
    verificationId: "HH-LAB-2026-000001",
    role: "laboratory",
    professionalName: "Chaudhary Lab",
    licenseNumber: "",
    registrationNumber: "",
    organizationName: "",
    address: "",
    documents: [
      {
        type: "Laboratory License",
        url: "https://files.example/license.pdf",
        contentHash: "license-hash",
      },
      {
        type: "Government ID",
        url: "https://files.example/id.pdf",
        contentHash: "id-hash",
      },
    ],
    notes: "",
    status: "PENDING",
    async save() { this.saved = true; },
  };
  const originalLoad = Module._load;
  const controllerPath = require.resolve("../controllers/verificationController");
  delete require.cache[controllerPath];
  Module._load = function (request, parent, isMain) {
    if (request === "../models/user") {
      return { findById: async () => user };
    }
    if (request === "../models/verification") {
      return {
        findOne() { return { sort: async () => verification }; },
      };
    }
    if (request === "../utils/cloudinaryUpload") return async () => ({});
    if (request === "../config/cloudinary") return { config: () => ({}) };
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const { createVerification } = require("../controllers/verificationController");
    const response = await invoke(createVerification, {
      user: { id: user._id },
      body: {
        role: "laboratory",
        licenseNumber: "12345678",
        licenseType: "Laboratory License",
        businessName: "Chaudhary Lab",
        registrationNumber: "123456",
        documents: verification.documents,
      },
    });

    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    assert.equal(response.body.success, true);
    assert.equal(verification.licenseNumber, "12345678");
    assert.equal(verification.organizationName, "Chaudhary Lab");
    assert.equal(verification.registrationNumber, "123456");
    assert.equal(verification.documents.length, 2);
    assert.equal(verification.status, "PENDING");
    assert.equal(user.verificationStatus, "PENDING");
    assert.equal(verification.saved, true);
    assert.equal(user.saved, true);
  } finally {
    Module._load = originalLoad;
    delete require.cache[controllerPath];
  }
});
