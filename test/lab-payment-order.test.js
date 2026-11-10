const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

test("Lab online checkout uses stored amount and reuses a pending Razorpay order", async () => {
  process.env.RAZORPAY_KEY_ID = "rzp_test_key";
  process.env.RAZORPAY_KEY_SECRET = "test_secret";

  const patient = {
    _id: "507f1f77bcf86cd799439011",
    name: "Sanvi",
    phone: "9313069960",
    role: "patient",
    accountStatus: "ACTIVE",
  };
  const labOrder = {
    _id: "507f1f77bcf86cd799439033",
    patientId: patient._id,
    patientName: patient.name,
    patientPhone: patient.phone,
    labId: "507f1f77bcf86cd799439022",
    totalAmount: 12.34,
    paymentMethod: "ONLINE",
    paymentStatus: "Pending",
    status: "Pending",
  };
  const state = { payments: [], orderCalls: 0 };
  const paymentModel = {
    async findOne(filter) {
      return state.payments.find((payment) =>
        payment.serviceType === filter.serviceType &&
        payment.serviceId === filter.serviceId &&
        payment.userId === filter.userId &&
        payment.status === filter.status
      ) || null;
    },
    async create(payment) {
      const saved = {
        ...payment,
        _id: "507f1f77bcf86cd799439044",
      };
      state.payments.push(saved);
      return saved;
    },
  };
  const modelStubs = {
    "../models/Payment": paymentModel,
    "../models/orderModel": {},
    "../models/Appointment": {},
    "../models/user": { findById: async () => patient },
    "../models/labOrder": { findById: async () => labOrder },
  };
  class FakeObjectId {
    constructor(value) {
      this.value = String(value);
    }
    static isValid(value) {
      return /^[a-f\d]{24}$/i.test(String(value));
    }
  }
  class FakeRazorpay {
    constructor() {
      this.orders = {
        create: async (order) => {
          state.orderCalls += 1;
          return { ...order, id: "order_lab_1" };
        },
      };
    }
  }
  const originalLoad = Module._load;
  const controllerPath = require.resolve("../controllers/paymentController");
  let controller;

  try {
    delete require.cache[controllerPath];
    Module._load = function (request, parent, isMain) {
      if (request === "mongoose") {
        return {
          Types: { ObjectId: FakeObjectId },
          connection: {},
        };
      }
      if (request === "razorpay") return FakeRazorpay;
      if (Object.hasOwn(modelStubs, request)) return modelStubs[request];
      return originalLoad.call(this, request, parent, isMain);
    };
    controller = require("../controllers/paymentController");

    const invoke = async () => {
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
      await controller.createOrder(
        {
          user: { id: patient._id },
          body: { serviceType: "Lab", serviceId: labOrder._id },
        },
        res
      );
      return { statusCode, body };
    };

    const first = await invoke();
    assert.equal(first.statusCode, 200, JSON.stringify(first.body));
    assert.equal(first.body.order.amount, 1234);
    assert.equal(state.payments.length, 1);
    assert.equal(state.payments[0].serviceType, "Lab");
    assert.equal(state.payments[0].serviceId, labOrder._id);

    const retry = await invoke();
    assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
    assert.equal(retry.body.reused, true);
    assert.equal(retry.body.order.id, first.body.order.id);
    assert.equal(state.orderCalls, 1);
    assert.equal(state.payments.length, 1);

    labOrder.paymentMethod = "COD";
    const codRequest = await invoke();
    assert.equal(codRequest.statusCode, 409);
    assert.equal(state.orderCalls, 1);
    assert.equal(state.payments.length, 1);
  } finally {
    Module._load = originalLoad;
    delete require.cache[controllerPath];
  }
});
