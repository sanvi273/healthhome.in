const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Module = require("node:module");

const loadController = ({ patient, order, state }) => {
  class FakeObjectId {
    constructor(value) { this.value = String(value); }
    static isValid(value) { return /^[a-f\d]{24}$/i.test(String(value)); }
  }
  class FakeRazorpay {
    constructor() {
      this.orders = {
        create: async (payload) => {
          state.orderCalls += 1;
          return { ...payload, id: "order_pharmacy_1" };
        },
      };
      this.payments = {
        fetch: async (id) => ({
          id,
          order_id: "order_pharmacy_1",
          amount: 1250,
          currency: "INR",
          status: "captured",
          method: "upi",
        }),
      };
    }
  }

  const paymentModel = {
    async findOne(filter) {
      return state.payments.find((payment) =>
        payment.serviceType === filter.serviceType &&
        payment.serviceId === filter.serviceId &&
        payment.userId === filter.userId &&
        payment.status === filter.status
      ) || null;
    },
    async create(record) {
      const saved = { ...record, _id: "507f1f77bcf86cd799439099" };
      state.payments.push(saved);
      return saved;
    },
    async findOneAndUpdate(filter, update, options) {
      state.verifyFilter = filter;
      state.verifyOptions = options;
      const payment = state.payments.find((candidate) =>
        candidate.serviceType === filter.serviceType &&
        candidate.serviceId === filter.serviceId &&
        candidate.userId === filter.userId &&
        ["Pending", "Success"].includes(candidate.status) &&
        (candidate.razorpayOrderId === "order_pharmacy_1" ||
          candidate.orderId === "order_pharmacy_1")
      );
      if (!payment) return null;
      Object.assign(payment, update.$set);
      return payment;
    },
  };
  const modelStubs = {
    "../models/Payment": paymentModel,
    "../models/orderModel": {
      findById: async () => order,
      findByIdAndUpdate: async (id, update) => {
        Object.assign(order, update.$set);
        return order;
      },
    },
    "../models/Appointment": {},
    "../models/user": { findById: async () => patient },
  };

  const originalLoad = Module._load;
  const controllerPath = require.resolve("../controllers/paymentController");
  delete require.cache[controllerPath];
  Module._load = function (request, parent, isMain) {
    if (request === "mongoose") {
      return { Types: { ObjectId: FakeObjectId }, connection: {} };
    }
    if (request === "razorpay") return FakeRazorpay;
    if (Object.hasOwn(modelStubs, request)) return modelStubs[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  const controller = require("../controllers/paymentController");

  return {
    controller,
    restore() {
      Module._load = originalLoad;
      delete require.cache[controllerPath];
    },
  };
};

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

const makeFixture = (paymentMethod = "ONLINE") => {
  const patient = {
    _id: "507f1f77bcf86cd799439011",
    name: "Sanvi",
    phone: "9313069960",
    role: "patient",
    accountStatus: "ACTIVE",
  };
  const order = {
    _id: "507f1f77bcf86cd799439022",
    patientId: patient.phone,
    patientName: patient.name,
    patientPhone: patient.phone,
    pharmacyId: "507f1f77bcf86cd799439033",
    totalAmount: 12.5,
    paymentMethod,
    paymentStatus: "Pending",
    status: "Pending",
  };
  return { patient, order, state: { payments: [], orderCalls: 0 } };
};

test("pharmacy online checkout reuses pending Razorpay order and blocks COD", async () => {
  process.env.RAZORPAY_KEY_ID = "rzp_test_key";
  process.env.RAZORPAY_KEY_SECRET = "test_secret";
  const fixture = makeFixture();
  const { controller, restore } = loadController(fixture);
  const request = {
    user: { id: fixture.patient._id },
    body: { serviceType: "Medicine", serviceId: fixture.order._id },
  };

  try {
    const first = await invoke(controller.createOrder, request);
    assert.equal(first.statusCode, 200, JSON.stringify(first.body));
    assert.equal(first.body.order.amount, 1250);
    assert.equal(fixture.state.payments.length, 1);

    const retry = await invoke(controller.createOrder, request);
    assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
    assert.equal(retry.body.reused, true);
    assert.equal(retry.body.order.id, first.body.order.id);
    assert.equal(fixture.state.orderCalls, 1);
    assert.equal(fixture.state.payments.length, 1);

    fixture.order.paymentMethod = "COD";
    const cod = await invoke(controller.createOrder, request);
    assert.equal(cod.statusCode, 409);
    assert.equal(fixture.state.orderCalls, 1);
  } finally {
    restore();
  }
});

test("pharmacy verification updates only its exact authenticated payment record", async () => {
  process.env.RAZORPAY_KEY_ID = "rzp_test_key";
  process.env.RAZORPAY_KEY_SECRET = "test_secret";
  const fixture = makeFixture();
  fixture.state.payments.push({
    _id: "507f1f77bcf86cd799439044",
    serviceType: "Medicine",
    serviceId: fixture.order._id,
    userId: fixture.patient._id,
    orderId: "order_pharmacy_1",
    razorpayOrderId: "order_pharmacy_1",
    amount: 12.5,
    status: "Pending",
  });
  const { controller, restore } = loadController(fixture);
  const paymentId = "pay_pharmacy_1";
  const signature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`order_pharmacy_1|${paymentId}`)
    .digest("hex");

  try {
    const response = await invoke(controller.verifyPayment, {
      user: { id: fixture.patient._id },
      body: {
        serviceType: "pharmacy",
        serviceId: fixture.order._id,
        razorpayOrderId: "order_pharmacy_1",
        razorpayPaymentId: paymentId,
        razorpaySignature: signature,
      },
    });
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    assert.equal(response.body.paid, true);
    assert.equal(fixture.state.verifyFilter.serviceId, fixture.order._id);
    assert.equal(fixture.state.verifyFilter.userId, fixture.patient._id);
    assert.equal(fixture.state.verifyOptions.upsert, false);
    assert.equal(fixture.order.paymentStatus, "Paid");
  } finally {
    restore();
  }
});
