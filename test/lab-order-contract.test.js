const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

test("lab booking uses authenticated patient identity and persists the contract fields", async () => {
  const savedOrders = [];
  const patient = {
    _id: "507f1f77bcf86cd799439011",
    name: "Test Patient",
    phone: "9876543210",
    role: "patient",
    accountStatus: "ACTIVE",
  };
  const lab = {
    _id: "507f1f77bcf86cd799439022",
    name: "HealthHome Lab",
    available: true,
    tests: [{ testName: "CBC", price: 250, isActive: true }],
  };
  const models = {
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
  let addLabOrder;

  let statusCode;
  let responseBody;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    },
  };

  try {
    delete require.cache[controllerPath];
    Module._load = function (request, parent, isMain) {
      if (Object.hasOwn(models, request)) return models[request];
      return originalLoad.call(this, request, parent, isMain);
    };
    ({ addLabOrder } = require("../controllers/labOrderController"));

    await addLabOrder(
      {
        user: { id: patient._id },
        body: {
          labId: lab._id,
          labName: "Client supplied name",
          tests: ["CBC"],
          collectionMode: "Visit Laboratory",
          address: "",
          paymentMethod: "ONLINE",
          bookingType: "TEST",
        },
      },
      res
    );
  } finally {
    Module._load = originalLoad;
    delete require.cache[controllerPath];
  }

  assert.equal(statusCode, 201, JSON.stringify(responseBody));
  assert.equal(savedOrders.length, 1);
  assert.equal(savedOrders[0].patientId, patient._id);
  assert.equal(savedOrders[0].patientName, patient.name);
  assert.equal(savedOrders[0].patientPhone, patient.phone);
  assert.equal(savedOrders[0].labId, lab._id);
  assert.deepEqual(savedOrders[0].tests, ["CBC"]);
  assert.equal(savedOrders[0].collectionMode, "Visit Laboratory");
  assert.equal(savedOrders[0].paymentMethod, "ONLINE");
});
