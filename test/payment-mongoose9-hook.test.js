const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

test("Payment pre-save hook uses the Mongoose 9 no-callback contract", () => {
  let saveHook;
  class FakeSchema {
    pre(name, hook) {
      if (name === "save") saveHook = hook;
    }
    index() {}
  }
  const fakeMongoose = {
    Schema: FakeSchema,
    model(_name, schema) {
      return schema;
    },
  };
  const modelPath = require.resolve("../models/Payment");
  const originalLoad = Module._load;

  try {
    delete require.cache[modelPath];
    Module._load = function (request, parent, isMain) {
      if (request === "mongoose") return fakeMongoose;
      return originalLoad.call(this, request, parent, isMain);
    };
    require("../models/Payment");
  } finally {
    Module._load = originalLoad;
    delete require.cache[modelPath];
  }

  assert.equal(typeof saveHook, "function");
  assert.equal(saveHook.length, 0);

  const payment = {
    orderId: "order-1",
    paymentId: "payment-1",
    signature: "signature-1",
    status: "Success",
    paymentStatus: "PENDING",
  };
  assert.doesNotThrow(() => saveHook.call(payment));
  assert.equal(payment.razorpayOrderId, "order-1");
  assert.equal(payment.razorpayPaymentId, "payment-1");
  assert.equal(payment.razorpaySignature, "signature-1");
  assert.equal(payment.paymentStatus, "SUCCESS");
  assert.equal(payment.verificationStatus, "VERIFIED");
});
