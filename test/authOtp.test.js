const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = "test-only-healthhome-secret";

const User = require("../models/user");
const AuthRateLimit = require("../models/authRateLimit");
const Verification = require("../models/verification");
const firebaseAdminAuth = require("../services/firebaseAdminAuth");
const termsAcceptanceService = require("../services/termsAcceptanceService");
const authController = require("../controllers/authController");
authController.generateVerificationId = async () => "HH-DOC-2026-000001";
const { registerUser } = require("../controllers/authRegistrationController");
const { loginUser } = authController;

const original = {
  verifyFirebaseIdToken: firebaseAdminAuth.verifyFirebaseIdToken,
  userFindOne: User.findOne,
  userFind: User.find,
  userCreate: User.create,
  userDelete: User.findByIdAndDelete,
  rateLimitUpdate: AuthRateLimit.findOneAndUpdate,
  verificationCreate: Verification.create,
  verificationDelete: Verification.deleteOne,
  termsGet: termsAcceptanceService.getCurrentTerms,
  termsFindToken: termsAcceptanceService.findAcceptanceToken,
  termsFindById: termsAcceptanceService.findAcceptanceById,
  termsAssociate: termsAcceptanceService.associateAcceptance,
  termsHasAcceptance: termsAcceptanceService.hasCurrentAcceptance,
};

const identity = {
  uid: "firebase-uid-1",
  phoneNumber: "+919876543210",
  normalizedPhone: "919876543210",
  storedPhone: "9876543210",
};

let existingRegistration;
let loginMatches;
let foundTerms;
let createdUserData;
let verificationCreated;

function queryResult(value) {
  return {
    select() { return this; },
    lean() { return Promise.resolve(value); },
  };
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function request(body, ip = `127.0.0.${Math.floor(Math.random() * 200) + 1}`) {
  return { body, ip };
}

function validRegistration(overrides = {}) {
  return {
    idToken: "valid-id-token",
    name: "Sanvi Test",
    role: "patient",
    label: "Home",
    fullAddress: "12 Test Road",
    city: "Ahmedabad",
    state: "Gujarat",
    pincode: "380001",
    termsAcceptanceToken: "accepted-terms-token",
    // A body phone must never override the verified Firebase phone claim.
    phone: "+10000000000",
    ...overrides,
  };
}

function resetMocks() {
  existingRegistration = null;
  loginMatches = [];
  foundTerms = true;
  createdUserData = null;
  verificationCreated = null;

  firebaseAdminAuth.verifyFirebaseIdToken = async (token) => {
    if (token === "expired-id-token") {
      const error = new Error("expired");
      error.code = "auth/id-token-expired";
      throw error;
    }
    if (token !== "valid-id-token") {
      const error = new Error("invalid");
      error.code = "auth/invalid-id-token";
      throw error;
    }
    return identity;
  };
  User.findOne = () => queryResult(existingRegistration);
  User.find = () => ({ limit: async () => loginMatches });
  User.create = async (data) => {
    createdUserData = data;
    return {
      ...data,
      _id: "mongo-user-1",
      accountStatus: "ACTIVE",
      verificationStatus: data.verificationStatus,
      verificationId: data.verificationId,
    };
  };
  User.findByIdAndDelete = async () => {};
  AuthRateLimit.findOneAndUpdate = async () => ({ count: 1 });
  Verification.create = async (record) => { verificationCreated = record; };
  Verification.deleteOne = async () => {};
  termsAcceptanceService.getCurrentTerms = (role) => ({ role });
  termsAcceptanceService.findAcceptanceToken = async () => foundTerms ? { _id: "terms-1" } : null;
  termsAcceptanceService.findAcceptanceById = async () => foundTerms ? { _id: "terms-1" } : null;
  termsAcceptanceService.associateAcceptance = async () => true;
  termsAcceptanceService.hasCurrentAcceptance = async () => true;
}

test("Firebase phone OTP auth controller cases", async (t) => {
  const testCase = async (name, body) => {
    await t.test(name, async () => {
      resetMocks();
      await body();
    });
  };
  try {
    await testCase("verified signup creates a passwordless Mongo user and HealthHome JWT", async () => {
      const captured = responseRecorder();
      await registerUser(request(validRegistration()), captured);
      assert.equal(captured.statusCode, 201);
      assert.equal(captured.body.success, true);
      assert.equal(captured.body.registered, true);
      assert.ok(captured.body.token);
      assert.equal(createdUserData.phone, identity.storedPhone);
      assert.equal(Object.hasOwn(createdUserData, "password"), false);
      assert.equal(createdUserData.email, "9876543210@gmail.com");
    });

    await testCase("invalid Firebase token is rejected before account creation", async () => {
      const res = responseRecorder();
      await registerUser(request(validRegistration({ idToken: "bad-token" })), res);
      assert.equal(res.statusCode, 401);
      assert.equal(res.body.code, "FIREBASE_ID_TOKEN_INVALID");
      assert.equal(createdUserData, null);
    });

    await testCase("missing Admin SDK credentials return a setup error", async () => {
      firebaseAdminAuth.verifyFirebaseIdToken = async () => {
        const error = new Error("credentials missing");
        error.code = "FIREBASE_ADMIN_UNAVAILABLE";
        throw error;
      };
      const res = responseRecorder();
      await registerUser(request(validRegistration()), res);
      assert.equal(res.statusCode, 503);
      assert.equal(res.body.code, "FIREBASE_AUTH_UNAVAILABLE");
    });

    await testCase("expired Firebase token requires a fresh OTP", async () => {
      const res = responseRecorder();
      await loginUser(request({ idToken: "expired-id-token", role: "patient" }), res);
      assert.equal(res.statusCode, 401);
      assert.equal(res.body.code, "FIREBASE_ID_TOKEN_INVALID");
    });

    await testCase("unregistered verified phone receives signup direction", async () => {
      const res = responseRecorder();
      await loginUser(request({ idToken: "valid-id-token", role: "patient" }), res);
      assert.equal(res.statusCode, 404);
      assert.equal(res.body.code, "ACCOUNT_NOT_FOUND");
    });

    await testCase("duplicate phone signup is blocked", async () => {
      existingRegistration = { _id: "existing-user" };
      const res = responseRecorder();
      await registerUser(request(validRegistration()), res);
      assert.equal(res.statusCode, 409);
      assert.equal(res.body.code, "ACCOUNT_ALREADY_EXISTS");
      assert.equal(createdUserData, null);
    });

    await testCase("invalid signup role is rejected", async () => {
      const res = responseRecorder();
      await registerUser(request(validRegistration({ role: "admin" })), res);
      assert.equal(res.statusCode, 400);
      assert.equal(createdUserData, null);
    });

    await testCase("current role terms remain required for signup", async () => {
      foundTerms = false;
      const res = responseRecorder();
      await registerUser(request(validRegistration()), res);
      assert.equal(res.statusCode, 428);
      assert.equal(res.body.code, "TERMS_ACCEPTANCE_REQUIRED");
    });

    await testCase("professional signup keeps pending verification workflow", async () => {
      const res = responseRecorder();
      await registerUser(request(validRegistration({ role: "doctor" })), res);
      assert.equal(res.statusCode, 201);
      assert.equal(createdUserData.verificationStatus, "PENDING");
      assert.equal(verificationCreated.status, "PENDING");
      assert.equal(res.body.user.verificationId, "HH-DOC-2026-000001");
    });

    await testCase("verified login returns the existing Mongo user and JWT", async () => {
      loginMatches = [{
        _id: "existing-patient-id",
        name: "Patient",
        email: "patient@example.invalid",
        role: "patient",
        phone: "9876543210",
        accountStatus: "ACTIVE",
        verificationStatus: "NOT_REQUIRED",
        verificationId: "",
        addresses: [],
      }];
      const res = responseRecorder();
      await loginUser(request({ idToken: "valid-id-token", role: "patient" }), res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.user._id, "existing-patient-id");
      assert.ok(res.body.token);
    });

    await testCase("verified login cannot switch the Mongo account role", async () => {
      loginMatches = [{ _id: "doctor-id", role: "doctor" }];
      const res = responseRecorder();
      await loginUser(request({ idToken: "valid-id-token", role: "patient" }), res);
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.code, "ACCOUNT_ROLE_MISMATCH");
    });

    await testCase("duplicate legacy Mongo phone records fail closed", async () => {
      loginMatches = [{ _id: "patient-1" }, { _id: "patient-2" }];
      const res = responseRecorder();
      await loginUser(request({ idToken: "valid-id-token", role: "patient" }), res);
      assert.equal(res.statusCode, 409);
      assert.equal(res.body.code, "DUPLICATE_PHONE_ACCOUNTS");
    });

    await testCase("suspended account remains blocked after phone verification", async () => {
      loginMatches = [{
        _id: "suspended-user",
        role: "patient",
        accountStatus: "SUSPENDED",
        suspensionReason: "Review required",
      }];
      const res = responseRecorder();
      await loginUser(request({ idToken: "valid-id-token", role: "patient" }), res);
      assert.equal(res.statusCode, 403);
      assert.match(res.body.message, /suspended/i);
    });

    await testCase("missing required profile fields are rejected", async () => {
      const res = responseRecorder();
      await registerUser(request(validRegistration({ fullAddress: "" })), res);
      assert.equal(res.statusCode, 400);
    });

    assert.equal(User.schema.path("password").isRequired, false);
  } finally {
    firebaseAdminAuth.verifyFirebaseIdToken = original.verifyFirebaseIdToken;
    User.findOne = original.userFindOne;
    User.find = original.userFind;
    User.create = original.userCreate;
    User.findByIdAndDelete = original.userDelete;
    AuthRateLimit.findOneAndUpdate = original.rateLimitUpdate;
    Verification.create = original.verificationCreate;
    Verification.deleteOne = original.verificationDelete;
    termsAcceptanceService.getCurrentTerms = original.termsGet;
    termsAcceptanceService.findAcceptanceToken = original.termsFindToken;
    termsAcceptanceService.findAcceptanceById = original.termsFindById;
    termsAcceptanceService.associateAcceptance = original.termsAssociate;
    termsAcceptanceService.hasCurrentAcceptance = original.termsHasAcceptance;
  }
});
