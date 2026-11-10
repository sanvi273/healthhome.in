const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

test("lab booking persists authenticated patient identity and selected payment method", async () => {
  const savedOrders = [];
  const patient = {
    _id: "507f1f77bcf86cd799439011",
    name: "Sanvi",
    phone: "9313069960",
    role: "patient",
    accountStatus: "ACTIVE",
  };
  const lab = {
    _id: "507f1f77bcf86cd799439022",
    name: "Sanvi Lab",
    available: true,
    tests: [{ testName: "Blood Test", price: 1, isActive: true }],
  };
  const modelStubs = {
    "../models/labOrder": {
      create: async (order) => {
        savedOrders.push(order);
        return { ...order, _id: "507f1f77bcf86cd799439033" };
      },
    },
    "../models/sampleCollector": {},
    "../models/lab": { findById: async () => lab },
    "../models/user": { findById: async () => patient },
  };
  const controllerPath = require.resolve("../controllers/labOrderController");
  const originalLoad = Module._load;
  let controller;
  let statusCode;
  let body;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      body = value;
      return this;
    },
  };

  try {
    delete require.cache[controllerPath];
    Module._load = function (request, parent, isMain) {
      if (Object.hasOwn(modelStubs, request)) return modelStubs[request];
      return originalLoad.call(this, request, parent, isMain);
    };
    controller = require("../controllers/labOrderController");
    await controller.addLabOrder(
      {
        user: { id: patient._id },
        body: {
          patientId: patient.phone,
          patientName: "Client supplied name",
          patientPhone: "0000000000",
          labId: lab._id,
          tests: ["Blood Test"],
          collectionMode: "Visit Laboratory",
          paymentMethod: "COD",
          bookingType: "TEST",
        },
      },
      res
    );
  } finally {
    Module._load = originalLoad;
    delete require.cache[controllerPath];
  }

  assert.equal(statusCode, 201, JSON.stringify(body));
  assert.equal(savedOrders.length, 1);
  assert.equal(savedOrders[0].patientId, patient._id);
  assert.equal(savedOrders[0].patientName, patient.name);
  assert.equal(savedOrders[0].patientPhone, patient.phone);
  assert.equal(savedOrders[0].paymentMethod, "COD");
  assert.equal(savedOrders[0].totalAmount, 1);
  assert.deepEqual(savedOrders[0].tests, ["Blood Test"]);
});
