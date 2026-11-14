const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Module = require("node:module");
const bcrypt = require("bcryptjs");

const roles = ["patient", "doctor", "laboratory", "pharmacy"];
const phone = "9876543210";

function makeUser(role, index) {
  return {
    _id: `507f1f77bcf86cd7994390${String(index + 1).padStart(2, "0")}`,
    name: `Test ${role}`,
    email: `${role}@example.test`,
    role,
    phone: `987654321${index}`,
    password: null,
    passwordChangedAt: null,
    accountStatus: "ACTIVE",
    verificationStatus: role === "patient" ? "NOT_REQUIRED" : "APPROVED",
    async save() {
      this.saved = true;
    },
  };
}

function makeHarness(users) {
  const state = {
    users,
    lookups: [],
    tokens: [],
    sms: [],
    rateLimits: new Map(),
  };
  const userModel = {
    findOne(query) {
      state.lookups.push(query);
      const user = state.users.find((candidate) => {
        const matchesPhone =
          typeof query.phone === "string"
            ? query.phone === candidate.phone
            : query.phone?.$in.includes(candidate.phone);
        return matchesPhone && candidate.role === query.role && candidate.accountStatus !== "SUSPENDED";
      });
      return queryFor(user || null);
    },
    findById(id) {
      const user = state.users.find((candidate) => String(candidate._id) === String(id));
      return queryFor(user || null);
    },
    async findOneAndUpdate(query, update) {
      const user = state.users.find((candidate) => {
        if (String(candidate._id) !== String(query._id) || candidate.role !== query.role) {
          return false;
        }
        if (query.accountStatus?.$ne && candidate.accountStatus === query.accountStatus.$ne) {
          return false;
        }
        const expectedChangedAt = query.passwordChangedAt;
        if (expectedChangedAt == null) return candidate.passwordChangedAt == null;
        return candidate.passwordChangedAt?.getTime() === expectedChangedAt.getTime();
      });
      if (!user) return null;
      Object.assign(user, update.$set);
      return user;
    },
  };
  const authRateLimitModel = {
    findOneAndUpdate(query) {
      const count = (state.rateLimits.get(query._id) || 0) + 1;
      state.rateLimits.set(query._id, count);
      return Promise.resolve({ count });
    },
  };
  const resetTokenModel = {
    async updateMany(query, update) {
      for (const record of state.tokens) {
        if (
          String(record.userId) === String(query.userId) &&
          record.role === query.role &&
          record.consumedAt == null
        ) {
          record.consumedAt = update.$set.consumedAt;
        }
      }
      return { modifiedCount: 0 };
    },
    async create(record) {
      const saved = {
        ...record,
        _id: `reset-token-${state.tokens.length + 1}`,
        createdAt: new Date(),
        consumedAt: null,
      };
      state.tokens.push(saved);
      return saved;
    },
    async updateOne(query, update) {
      const record = state.tokens.find((token) => token.tokenHash === query.tokenHash);
      if (record) record.consumedAt = update.$set.consumedAt;
      return { modifiedCount: record ? 1 : 0 };
    },
    findOne(query) {
      const record = state.tokens.find((token) =>
        token.tokenHash === query.tokenHash &&
        token.role === query.role &&
        token.consumedAt == null &&
        token.expiresAt > query.expiresAt.$gt,
      );
      return {
        lean: async () => (record ? { ...record } : null),
        select: () => ({
          lean: async () => (record ? { ...record } : null),
        }),
      };
    },
    async findOneAndUpdate(query, update) {
      const record = state.tokens.find((token) =>
        (!query._id || String(token._id) === String(query._id)) &&
        token.tokenHash === query.tokenHash &&
        token.role === query.role &&
        token.consumedAt == null &&
        token.expiresAt > query.expiresAt.$gt,
      );
      if (!record) return null;
      record.consumedAt = update.$set.consumedAt;
      return record;
    },
  };
  const loadStubs = new Map([
    ["../models/user", userModel],
    ["../models/authRateLimit", authRateLimitModel],
    ["../models/passwordResetToken", resetTokenModel],
  ]);

  return {
    state,
    loadStubs,
    userModel,
    async getController(relativePath) {
      const controllerPath = require.resolve(relativePath);
      delete require.cache[controllerPath];
      const originalLoad = Module._load;
      Module._load = function (request, parent, isMain) {
        if (loadStubs.has(request)) return loadStubs.get(request);
        if (request === "../services/termsAcceptanceService") {
          return {
            getCurrentTerms: () => ({}),
            hasCurrentAcceptance: async () => true,
            findAcceptanceToken: async () => null,
            associateAcceptance: async () => true,
          };
        }
        if (request === "../models/verification" || request === "../models/verificationCounter") {
          return {};
        }
        return originalLoad.call(this, request, parent, isMain);
      };
      try {
        return require(controllerPath);
      } finally {
        Module._load = originalLoad;
      }
    },
  };
}

function queryFor(value) {
  return {
    select: async () => value,
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    },
  };
}

async function invokeJson(handler, request) {
  let statusCode = 200;
  let body;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      body = value;
      return this;
    },
  };
  await handler(request, response);
  return { statusCode, body };
}

async function invokePage(handler, request) {
  let statusCode = 200;
  let contentType = "";
  let body = "";
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    type(value) {
      contentType = value;
      return this;
    },
    set() {
      return this;
    },
    send(value) {
      body = value;
      return this;
    },
  };
  await handler(request, response);
  return { statusCode, contentType, body };
}

async function requestLink(controller, mobile, role, ip = "127.0.0.1") {
  const response = await invokeJson(controller.requestPasswordReset, {
    body: { phone: mobile, role },
    ip,
  });
  await controller.flushPendingResetJobs();
  return response;
}

async function updatePassword(controller, token, role, password, mobile = phone) {
  return invokeJson(controller.completePasswordReset, {
    body: { resetToken: token, role, phone: mobile, password },
  });
}

async function withResetEnvironment(action) {
  const previous = {
    MSG91_AUTH_KEY: process.env.MSG91_AUTH_KEY,
    MSG91_PASSWORD_RESET_FLOW_ID: process.env.MSG91_PASSWORD_RESET_FLOW_ID,
    PASSWORD_RESET_PUBLIC_API_URL: process.env.PASSWORD_RESET_PUBLIC_API_URL,
    JWT_SECRET: process.env.JWT_SECRET,
  };
  const previousFetch = global.fetch;
  process.env.MSG91_AUTH_KEY = "test-msg91-key";
  process.env.MSG91_PASSWORD_RESET_FLOW_ID = "flow-test-id";
  process.env.PASSWORD_RESET_PUBLIC_API_URL = "https://api.example.test";
  process.env.JWT_SECRET = "test-jwt-secret-for-password-reset";
  const state = { smsRequests: [] };
  global.fetch = async (url, options) => {
    state.smsRequests.push({ url, options, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ type: "success" }) };
  };
  try {
    await action(state);
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("patient, doctor, laboratory, and pharmacy reset links update only their own role account", async () => {
  await withResetEnvironment(async ({ smsRequests }) => {
    const users = await Promise.all(roles.map((role, index) => makeUser(role, index)));
    for (const user of users) user.password = await bcrypt.hash("OldPass123", 4);
    const harness = makeHarness(users);
    const controller = await harness.getController("../controllers/passwordResetController");

    for (const role of roles) {
      const user = users.find((candidate) => candidate.role === role);
      const response = await requestLink(controller, user.phone, role);
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.success, true);
      assert.match(response.body.message, /If an account matches/);
      assert.equal(harness.state.lookups.at(-1).role, role);
      assert.equal(harness.state.tokens.at(-1).role, role);
      assert.equal(harness.state.tokens.at(-1).tokenHash.length, 64);
      assert.equal(Object.hasOwn(harness.state.tokens.at(-1), "token"), false);

      const sms = smsRequests.at(-1);
      assert.equal(sms.url, "https://control.msg91.com/api/v5/flow");
      assert.equal(sms.body.template_id, "flow-test-id");
      assert.equal(sms.body.recipients[0].mobiles, `91${user.phone}`);
      assert.equal(sms.body.recipients[0].VAR1.includes("/api/auth/forgot-password/open?"), true);
      assert.equal(sms.body.recipients[0].VAR1.includes(`role=${role}`), true);
      assert.equal(Object.hasOwn(sms.body.recipients[0], "otp"), false);

      const linkToken = new URL(sms.body.recipients[0].VAR1).searchParams.get("token");
      assert.equal(linkToken.length, 43);
      const resetPage = await invokePage(controller.openPasswordResetPage, {
        query: { token: linkToken, role },
      });
      assert.equal(resetPage.statusCode, 200);
      assert.equal(resetPage.contentType, "html");
      assert.match(resetPage.body, /Reset Password/);
      assert.match(resetPage.body, /Registered Phone Number/);
      assert.match(resetPage.body, /appLink\('reset-password'\)/);
      const completion = await updatePassword(controller, linkToken, role, "NewPass456", user.phone);
      assert.equal(completion.statusCode, 200);
      assert.equal(completion.body.success, true);
      assert.equal(user.passwordChangedAt instanceof Date, true);
      assert.equal(await bcrypt.compare("NewPass456", user.password), true);
      assert.equal(await bcrypt.compare("OldPass123", user.password), false);

      const replay = await updatePassword(controller, linkToken, role, "AnotherPass789", user.phone);
      assert.equal(replay.statusCode, 401);
    }

    for (const role of roles) {
      const user = users.find((candidate) => candidate.role === role);
      const loginController = await harness.getController("../controllers/authController");
      const newPasswordLogin = await invokeJson(loginController.loginUser, {
        body: { phone: user.phone, password: "NewPass456", role },
      });
      assert.equal(newPasswordLogin.statusCode, 200, `${role} can log in with the new password`);
      assert.equal(newPasswordLogin.body.success, true);
      const oldPasswordLogin = await invokeJson(loginController.loginUser, {
        body: { phone: user.phone, password: "OldPass123", role },
      });
      assert.equal(oldPasswordLogin.statusCode, 400, `${role} cannot log in with the old password`);
    }
  });
});

test("invalid numbers and admin role cannot request password reset", async () => {
  await withResetEnvironment(async ({ smsRequests }) => {
    const harness = makeHarness([]);
    const controller = await harness.getController("../controllers/passwordResetController");

    const invalidPhone = await requestLink(controller, "123", "patient");
    assert.equal(invalidPhone.statusCode, 400);
    const admin = await requestLink(controller, phone, "admin");
    assert.equal(admin.statusCode, 400);
    assert.equal(smsRequests.length, 0);
    assert.equal(harness.state.lookups.length, 0);
  });
});

test("the generic response is returned before account lookup and SMS delivery", async () => {
  await withResetEnvironment(async ({ smsRequests }) => {
    const patient = makeUser("patient", 0);
    const harness = makeHarness([patient]);
    const controller = await harness.getController("../controllers/passwordResetController");
    const response = await invokeJson(controller.requestPasswordReset, {
      body: { phone: patient.phone, role: "patient" },
      ip: "127.0.0.2",
    });

    assert.equal(response.statusCode, 200);
    assert.equal(harness.state.lookups.length, 0);
    assert.equal(smsRequests.length, 0);
    await controller.flushPendingResetJobs();
    assert.equal(harness.state.lookups.length, 1);
    assert.equal(smsRequests.length, 1);
  });
});

test("an unregistered mobile gets the same response and no SMS is sent", async () => {
  await withResetEnvironment(async ({ smsRequests }) => {
    const harness = makeHarness([]);
    const controller = await harness.getController("../controllers/passwordResetController");
    const response = await requestLink(controller, phone, "patient");
    assert.equal(response.statusCode, 200);
    assert.match(response.body.message, /If an account matches/);
    assert.equal(smsRequests.length, 0);
    assert.equal(harness.state.tokens.length, 0);
  });
});

test("a reset token cannot update a different role or use an expired link", async () => {
  await withResetEnvironment(async ({ smsRequests }) => {
    const doctor = makeUser("doctor", 0);
    doctor.password = await bcrypt.hash("OldPass123", 4);
    const harness = makeHarness([doctor]);
    const controller = await harness.getController("../controllers/passwordResetController");
    await requestLink(controller, doctor.phone, "doctor");
    const token = new URL(smsRequests[0].body.recipients[0].VAR1).searchParams.get("token");

    const wrongRole = await updatePassword(controller, token, "patient", "NewPass456", doctor.phone);
    assert.equal(wrongRole.statusCode, 401);
    assert.equal(await bcrypt.compare("OldPass123", doctor.password), true);

    const expiredToken = crypto.randomBytes(32).toString("base64url");
    harness.state.tokens.push({
      userId: doctor._id,
      role: "doctor",
      tokenHash: crypto.createHash("sha256").update(expiredToken).digest("hex"),
      expiresAt: new Date(Date.now() - 1000),
      consumedAt: null,
    });
    const expired = await updatePassword(controller, expiredToken, "doctor", "NewPass456", doctor.phone);
    assert.equal(expired.statusCode, 401);
  });
});

test("a reset token also requires the phone number bound to that role account", async () => {
  await withResetEnvironment(async ({ smsRequests }) => {
    const patient = makeUser("patient", 0);
    patient.password = await bcrypt.hash("OldPass123", 4);
    const harness = makeHarness([patient]);
    const controller = await harness.getController("../controllers/passwordResetController");
    await requestLink(controller, patient.phone, "patient");
    const token = new URL(smsRequests[0].body.recipients[0].VAR1).searchParams.get("token");

    const wrongPhone = await updatePassword(
      controller,
      token,
      "patient",
      "NewPass456",
      "9123456789",
    );
    assert.equal(wrongPhone.statusCode, 401);
    assert.equal(await bcrypt.compare("OldPass123", patient.password), true);

    const correctPhone = await updatePassword(
      controller,
      token,
      "patient",
      "NewPass456",
      patient.phone,
    );
    assert.equal(correctPhone.statusCode, 200);
    assert.equal(await bcrypt.compare("NewPass456", patient.password), true);
  });
});

test("concurrent submissions of one reset token only update the password once", async () => {
  await withResetEnvironment(async ({ smsRequests }) => {
    const patient = makeUser("patient", 0);
    patient.password = await bcrypt.hash("OldPass123", 4);
    const harness = makeHarness([patient]);
    const controller = await harness.getController("../controllers/passwordResetController");
    await requestLink(controller, patient.phone, "patient");
    const token = new URL(smsRequests[0].body.recipients[0].VAR1).searchParams.get("token");

    const results = await Promise.all([
      updatePassword(controller, token, "patient", "NewPass456", patient.phone),
      updatePassword(controller, token, "patient", "OtherPass789", patient.phone),
    ]);
    assert.equal(results.filter((result) => result.statusCode === 200).length, 1);
    assert.equal(results.filter((result) => result.statusCode === 401).length, 1);
    assert.equal(
      (await bcrypt.compare("NewPass456", patient.password)) ||
        (await bcrypt.compare("OtherPass789", patient.password)),
      true,
    );
  });
});

test("empty and weak passwords are rejected", async () => {
  await withResetEnvironment(async ({ smsRequests }) => {
    const patient = makeUser("patient", 0);
    patient.password = await bcrypt.hash("OldPass123", 4);
    const harness = makeHarness([patient]);
    const controller = await harness.getController("../controllers/passwordResetController");
    await requestLink(controller, patient.phone, "patient");
    const token = new URL(smsRequests[0].body.recipients[0].VAR1).searchParams.get("token");

    for (const password of ["", "12345678", "lettersOnly", "a1"]) {
      const response = await updatePassword(controller, token, "patient", password, patient.phone);
      assert.equal(response.statusCode, 400);
    }
    assert.equal(await bcrypt.compare("OldPass123", patient.password), true);
  });
});
