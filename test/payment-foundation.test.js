const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Module = require("node:module");

process.env.RAZORPAY_KEY_ID = "rzp_test_public_key";
process.env.RAZORPAY_KEY_SECRET = "unit_test_key_secret";
process.env.RAZORPAY_WEBHOOK_SECRET = "unit_test_webhook_secret";

const state = {};
const gatewayState = { orderCalls: 0, paymentResponses: new Map() };

const same = (left, right) => String(left ?? "") === String(right ?? "");
const matches = (doc, filter = {}) => {
  if (!doc) return false;
  for (const [key, expected] of Object.entries(filter)) {
    if (key === "$or") {
      if (!expected.some((part) => matches(doc, part))) return false;
      continue;
    }
    if (key === "$and") {
      if (!expected.every((part) => matches(doc, part))) return false;
      continue;
    }
    const actual = doc[key];
    if (expected && typeof expected === "object" && !Array.isArray(expected) && !(expected instanceof Date)) {
      for (const [operator, value] of Object.entries(expected)) {
        if (operator === "$in" && !value.some((item) => same(actual, item))) return false;
        if (operator === "$nin" && value.some((item) => same(actual, item))) return false;
        if (operator === "$ne" && same(actual, value)) return false;
        if (operator === "$lte" && !(new Date(actual) <= new Date(value))) return false;
        if (operator === "$lt" && !(new Date(actual) < new Date(value))) return false;
        if (operator === "$exists" && Boolean(actual !== undefined) !== value) return false;
      }
    } else if (!same(actual, expected)) {
      return false;
    }
  }
  return true;
};

const applyUpdate = (doc, update = {}) => {
  for (const [key, values] of Object.entries(update)) {
    if (key === "$set") Object.assign(doc, values);
    else if (key === "$inc") {
      for (const [field, amount] of Object.entries(values)) doc[field] = (doc[field] || 0) + amount;
    }
  }
  return doc;
};

const asQuery = (value) => {
  const promise = Promise.resolve(value);
  const query = {
    lean() { return promise; },
    sort() { return query; },
    then(resolve, reject) { return promise.then(resolve, reject); },
    catch(reject) { return promise.catch(reject); },
  };
  return query;
};

const asDocument = (value) => ({
  ...value,
  async save() { return this; },
  async updateOne(update) { applyUpdate(this, update); return { matchedCount: 1 }; },
});

const makeModel = (collectionName) => ({
  async init() { return this; },
  findById(id) { return asQuery(state[collectionName].find((item) => same(item._id, id)) || null); },
  findOne(filter) { return asQuery(state[collectionName].find((item) => matches(item, filter)) || null); },
  async create(value) {
    if (collectionName === "checkouts" && state.checkouts.some((item) => item.serviceKey === value.serviceKey)) {
      const error = new Error("duplicate service checkout");
      error.code = 11000;
      throw error;
    }
    if (collectionName === "webhookEvents" && state.webhookEvents.some((item) => item.eventId === value.eventId)) {
      const error = new Error("duplicate webhook event");
      error.code = 11000;
      throw error;
    }
    const generatedId = collectionName === "appointments"
      ? "888888888888888888888888"
      : `${collectionName}-${state[collectionName].length + 1}`;
    const doc = asDocument({ _id: generatedId, ...value });
    state[collectionName].push(doc);
    return doc;
  },
  async findOneAndUpdate(filter, update) {
    const doc = state[collectionName].find((item) => matches(item, filter));
    if (!doc) return null;
    applyUpdate(doc, update);
    return doc;
  },
  async findByIdAndUpdate(id, update) {
    const doc = state[collectionName].find((item) => same(item._id, id));
    if (!doc) return null;
    applyUpdate(doc, update);
    return doc;
  },
  async updateOne(filter, update) {
    const doc = state[collectionName].find((item) => matches(item, filter));
    if (!doc) return { matchedCount: 0, modifiedCount: 0 };
    applyUpdate(doc, update);
    return { matchedCount: 1, modifiedCount: 1 };
  },
  async updateMany(filter, update) {
    let modifiedCount = 0;
    for (const doc of state[collectionName].filter((item) => matches(item, filter))) {
      applyUpdate(doc, update);
      modifiedCount += 1;
    }
    return { matchedCount: modifiedCount, modifiedCount };
  },
  find(filter = {}) { return asQuery(state[collectionName].filter((item) => matches(item, filter))); },
});

const fakes = {
  Payment: makeModel("payments"),
  PaymentCheckout: makeModel("checkouts"),
  RazorpayWebhookEvent: makeModel("webhookEvents"),
  Order: makeModel("orders"),
  Appointment: makeModel("appointments"),
  LabOrder: makeModel("labOrders"),
  User: makeModel("users"),
  Pharmacy: makeModel("pharmacies"),
  Medicine: makeModel("medicines"),
};

class FakeObjectId {
  constructor(value) { this.value = String(value); }
  toString() { return this.value; }
  static isValid(value) { return /^[a-f\d]{24}$/i.test(String(value)); }
}

const fakeMongoose = {
  Types: { ObjectId: FakeObjectId },
  connection: {
    collection() {
      return { findOne: async () => state.doctorProfile || null };
    },
  },
};

const fakeGateway = {
  orders: {
    async create(options) {
      gatewayState.orderCalls += 1;
      return {
        id: `rzp_order_${gatewayState.orderCalls}`,
        amount: options.amount,
        currency: options.currency,
        receipt: options.receipt,
      };
    },
  },
  payments: {
    async fetch(paymentId) { return gatewayState.paymentResponses.get(paymentId) || null; },
  },
};

class FakeRazorpay {
  constructor() { return fakeGateway; }
}

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "mongoose") return fakeMongoose;
  if (request === "razorpay") return FakeRazorpay;
  const modelName = request.split(/[\\/]/).pop().toLowerCase();
  const modelMap = {
    payment: "Payment",
    paymentcheckout: "PaymentCheckout",
    razorpaywebhookevent: "RazorpayWebhookEvent",
    ordermodel: "Order",
    appointment: "Appointment",
    laborder: "LabOrder",
    user: "User",
    pharmacy: "Pharmacy",
    medicine: "Medicine",
  };
  if (modelMap[modelName]) return fakes[modelMap[modelName]];
  return originalLoad.call(this, request, parent, isMain);
};
const paymentController = require("../controllers/paymentController");
const orderController = require("../controllers/orderController");

const patient = (id = "111111111111111111111111") => ({
  _id: id,
  name: "Test Patient",
  phone: `phone-${id.slice(0, 4)}`,
  role: "patient",
  accountStatus: "ACTIVE",
});

const reset = () => {
  Object.assign(state, {
    payments: [], checkouts: [], webhookEvents: [], orders: [], appointments: [],
    labOrders: [], users: [], pharmacies: [], medicines: [], doctorProfile: null,
  });
  gatewayState.orderCalls = 0;
  gatewayState.paymentResponses.clear();
};

beforeEach(reset);

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const signedPayload = (body, secret) => crypto
  .createHmac("sha256", secret)
  .update(body)
  .digest("hex");

const addPaymentFor = async ({ type, serviceId, userId, amount }) => fakes.Payment.create({
  serviceType: type,
  serviceId,
  userId,
  userName: "Test Patient",
  userPhone: `phone-${userId.slice(0, 4)}`,
  amount: amount / 100,
  amountPaise: amount,
  currency: "INR",
  status: "Pending",
  paymentStatus: "PENDING",
  verificationStatus: "PENDING",
  orderId: "rzp_order_seed",
  razorpayOrderId: "rzp_order_seed",
});

const verifySignature = (orderId, paymentId) => signedPayload(
  `${orderId}|${paymentId}`,
  process.env.RAZORPAY_KEY_SECRET
);

test("Medicine checkout derives amount from the stored order and reuses a pending checkout", async () => {
  const user = patient();
  state.users.push(user);
  state.orders.push({
    _id: "222222222222222222222222",
    patientId: user._id,
    patientPhone: user.phone,
    totalAmount: 42.25,
    paymentStatus: "Pending",
    status: "Pending",
    pharmacyId: "pharmacy-1",
  });

  const req = { user: { id: user._id }, body: { serviceType: "Medicine", serviceId: state.orders[0]._id, amount: 0.01 } };
  const first = response();
  await paymentController.createOrder(req, first);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.amount, 4225);
  assert.equal(state.payments.length, 1);
  assert.equal(gatewayState.orderCalls, 1);

  const duplicate = response();
  await paymentController.createOrder(req, duplicate);
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.body.reused, true);
  assert.equal(duplicate.body.order.id, first.body.order.id);
  assert.equal(state.payments.length, 1);
  assert.equal(gatewayState.orderCalls, 1);
});

test("Lab checkout uses the authenticated owner, stored price, and one Razorpay order", async () => {
  const user = patient();
  state.users.push(user);
  state.labOrders.push({
    _id: "333333333333333333333333",
    patientId: user._id,
    patientPhone: user.phone,
    totalAmount: 123.45,
    paymentMethod: "ONLINE",
    paymentStatus: "Pending",
    status: "Pending",
    labId: "lab-1",
  });

  const req = {
    user: { id: user._id },
    body: {
      serviceType: "Lab",
      serviceId: state.labOrders[0]._id,
      amount: 0.01,
    },
  };
  const first = response();
  await paymentController.createOrder(req, first);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.amount, 12345);
  assert.equal(state.payments.length, 1);
  assert.equal(gatewayState.orderCalls, 1);

  const retry = response();
  await paymentController.createOrder(req, retry);
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.reused, true);
  assert.equal(gatewayState.orderCalls, 1);
});

test("COD Lab bookings cannot create an online Razorpay checkout", async () => {
  const user = patient();
  state.users.push(user);
  state.labOrders.push({
    _id: "444444444444444444444444",
    patientId: user._id,
    patientPhone: user.phone,
    totalAmount: 80,
    paymentMethod: "COD",
    paymentStatus: "Pending",
    status: "Pending",
  });

  const result = response();
  await paymentController.createOrder({
    user: { id: user._id },
    body: { serviceType: "Lab", serviceId: state.labOrders[0]._id },
  }, result);
  assert.equal(result.statusCode, 409);
  assert.equal(gatewayState.orderCalls, 0);
  assert.equal(state.payments.length, 0);
});

test("a legacy pending payment is linked to the checkout instead of creating another Razorpay order", async () => {
  const user = patient();
  state.users.push(user);
  state.orders.push({
    _id: "222222222222222222222222",
    patientId: user._id,
    patientPhone: user.phone,
    totalAmount: 42.25,
    paymentStatus: "Pending",
    status: "Pending",
  });
  const legacyPayment = await addPaymentFor({
    type: "Medicine",
    serviceId: "222222222222222222222222",
    userId: user._id,
    amount: 4225,
  });

  const result = response();
  await paymentController.createOrder({
    user: { id: user._id },
    body: { serviceType: "Medicine", serviceId: "222222222222222222222222" },
  }, result);

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.order.id, legacyPayment.razorpayOrderId);
  assert.equal(result.body.paymentRecordId, legacyPayment._id);
  assert.equal(gatewayState.orderCalls, 0);
  assert.equal(state.payments.length, 1);
});

test("Medicine and Lab payments verify idempotently without changing service status", async (t) => {
  for (const service of [
    { type: "Medicine", collection: "orders", id: "222222222222222222222222", amount: 42.25, providerId: "pharmacy-1", providerType: "Pharmacy" },
    { type: "Lab", collection: "labOrders", id: "333333333333333333333333", amount: 67.89, providerId: "lab-1", providerType: "Lab" },
  ]) {
    await t.test(service.type, async () => {
      reset();
      const user = patient();
      state.users.push(user);
      const serviceRecord = {
        _id: service.id,
        patientId: user._id,
        patientPhone: user.phone,
        totalAmount: service.amount,
        paymentStatus: "Pending",
        status: "Pending",
        ...(service.type === "Medicine" ? { pharmacyId: service.providerId } : { labId: service.providerId }),
      };
      state[service.collection].push(serviceRecord);

      const createRes = response();
      await paymentController.createOrder({
        user: { id: user._id },
        body: { serviceType: service.type, serviceId: service.id, amount: 1 },
      }, createRes);
      assert.equal(createRes.statusCode, 200);
      assert.equal(createRes.body.amount, Math.round(service.amount * 100));
      const orderId = createRes.body.order.id;
      const paymentId = `pay_${service.type.toLowerCase()}`;
      gatewayState.paymentResponses.set(paymentId, {
        id: paymentId,
        order_id: orderId,
        amount: Math.round(service.amount * 100),
        currency: "INR",
        status: "captured",
        method: "upi",
      });
      const verifyReq = {
        user: { id: user._id },
        body: {
          serviceType: service.type,
          serviceId: service.id,
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
          razorpay_signature: verifySignature(orderId, paymentId),
        },
      };
      const verified = response();
      await paymentController.verifyPayment(verifyReq, verified);
      assert.equal(verified.statusCode, 200);
      assert.equal(verified.body.paid, true);
      assert.equal(state.payments.length, 1);
      assert.equal(state.payments[0].amountPaise, Math.round(service.amount * 100));
      assert.equal(serviceRecord.paymentStatus, "Paid");
      assert.equal(serviceRecord.status, "Pending");

      const repeated = response();
      await paymentController.verifyPayment(verifyReq, repeated);
      assert.equal(repeated.statusCode, 200);
      assert.equal(state.payments.length, 1);
    });
  }
});

test("Payment save hook is compatible with Mongoose 9 pre-save middleware", () => {
  let registeredSaveHook;
  class FakeSchema {
    pre(name, hook) {
      if (name === "save") registeredSaveHook = hook;
    }
    index() {}
  }
  const fakeMongoose = {
    Schema: FakeSchema,
    model(_name, schema) { return schema; },
  };
  const paymentModelPath = require.resolve("../models/Payment");
  const previousLoad = Module._load;
  try {
    delete require.cache[paymentModelPath];
    Module._load = function (request, parent, isMain) {
      if (request === "mongoose") return fakeMongoose;
      return originalLoad.call(this, request, parent, isMain);
    };
    require("../models/Payment");
  } finally {
    Module._load = previousLoad;
    delete require.cache[paymentModelPath];
  }

  assert.equal(typeof registeredSaveHook, "function");
  assert.equal(registeredSaveHook.length, 0);
  const payment = {
    orderId: "order-1",
    paymentId: "payment-1",
    signature: "signature-1",
    status: "Success",
    paymentStatus: "PENDING",
  };
  assert.doesNotThrow(() => registeredSaveHook.call(payment));
  assert.equal(payment.razorpayOrderId, "order-1");
  assert.equal(payment.razorpayPaymentId, "payment-1");
  assert.equal(payment.razorpaySignature, "signature-1");
  assert.equal(payment.paymentStatus, "SUCCESS");
  assert.equal(payment.verificationStatus, "VERIFIED");
});

test("Doctor checkout reuses one appointment/order and verification preserves appointment status", async () => {
  const user = patient();
  const stranger = patient("999999999999999999999999");
  state.users.push(user, stranger);
  const doctorId = "444444444444444444444444";
  state.doctorProfile = {
    _id: doctorId,
    name: "Test Doctor",
    fees: "123.45",
    specialization: "General",
    hospital: "Clinic",
  };
  const req = {
    user: { id: user._id },
    body: { doctorId, appointmentDate: "2026-12-01", appointmentTime: "10:00", fee: 0.01 },
    files: [],
  };
  const first = response();
  await paymentController.createDoctorOrder(req, first);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.amount, 12345);
  assert.equal(state.appointments.length, 1);
  assert.equal(state.payments.length, 1);

  const duplicate = response();
  await paymentController.createDoctorOrder(req, duplicate);
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.body.reused, true);
  assert.equal(state.appointments.length, 1);
  assert.equal(state.payments.length, 1);
  assert.equal(gatewayState.orderCalls, 1);

  const paymentId = "pay_doctor";
  gatewayState.paymentResponses.set(paymentId, {
    id: paymentId,
    order_id: first.body.order.id,
    amount: 12345,
    currency: "INR",
    status: "captured",
    method: "netbanking",
  });
  const verifyReq = {
    user: { id: user._id },
    body: {
      appointmentId: first.body.appointmentId,
      razorpay_order_id: first.body.order.id,
      razorpay_payment_id: paymentId,
      razorpay_signature: verifySignature(first.body.order.id, paymentId),
    },
  };

  const otherPatientAttempt = response();
  await paymentController.verifyDoctorPayment({
    ...verifyReq,
    user: { id: stranger._id },
  }, otherPatientAttempt);
  assert.equal(otherPatientAttempt.statusCode, 403);
  assert.equal(state.payments[0].status, "Pending");
  assert.equal(state.appointments[0].paymentStatus, "Pending");

  const invalidSignature = response();
  await paymentController.verifyDoctorPayment({
    ...verifyReq,
    body: { ...verifyReq.body, razorpay_signature: "invalid-signature" },
  }, invalidSignature);
  assert.equal(invalidSignature.statusCode, 400);
  assert.equal(state.appointments[0].paymentStatus, "Pending");

  const verified = response();
  await paymentController.verifyDoctorPayment(verifyReq, verified);
  assert.equal(verified.statusCode, 200, JSON.stringify(verified.body));
  assert.equal(state.appointments[0].paymentStatus, "Paid");
  assert.equal(state.appointments[0].status, "Pending");

  const repeated = response();
  await paymentController.verifyDoctorPayment(verifyReq, repeated);
  assert.equal(repeated.statusCode, 200);
  assert.equal(state.payments.length, 1);
});

test("Payment creation, verification, details, and QR status enforce patient ownership", async () => {
  const owner = patient();
  const stranger = patient("999999999999999999999999");
  state.users.push(owner, stranger);
  const order = {
    _id: "222222222222222222222222",
    patientId: owner._id,
    patientPhone: owner.phone,
    totalAmount: 25,
    paymentStatus: "Pending",
    status: "Pending",
    pharmacyId: "pharmacy-1",
  };
  state.orders.push(order);
  const createRes = response();
  await paymentController.createOrder({
    user: { id: stranger._id },
    body: { serviceType: "Medicine", serviceId: order._id },
  }, createRes);
  assert.equal(createRes.statusCode, 403);
  assert.equal(gatewayState.orderCalls, 0);

  const payment = await addPaymentFor({ type: "Medicine", serviceId: order._id, userId: owner._id, amount: 2500 });
  payment._id = "555555555555555555555555";
  payment.orderId = "rzp_owned_order";
  payment.razorpayOrderId = "rzp_owned_order";
  const verify = response();
  await paymentController.verifyPayment({
    user: { id: stranger._id },
    body: {
      serviceType: "Medicine",
      serviceId: order._id,
      razorpay_order_id: payment.orderId,
      razorpay_payment_id: "pay_wrong_owner",
      razorpay_signature: verifySignature(payment.orderId, "pay_wrong_owner"),
    },
  }, verify);
  assert.equal(verify.statusCode, 403);

  const detail = response();
  await paymentController.getPaymentDetails({ user: { id: stranger._id }, params: { paymentId: payment._id } }, detail);
  assert.equal(detail.statusCode, 404);
  const qr = response();
  await paymentController.getQrPaymentStatus({ user: { id: stranger._id }, params: { paymentRecordId: payment._id } }, qr);
  assert.equal(qr.statusCode, 404);
});

test("Webhook rejects invalid signatures and safely ignores repeated valid delivery", async () => {
  const user = patient();
  state.users.push(user);
  const payment = await addPaymentFor({
    type: "Medicine",
    serviceId: "222222222222222222222222",
    userId: user._id,
    amount: 5000,
  });
  payment.orderId = "rzp_webhook_order";
  payment.razorpayOrderId = "rzp_webhook_order";
  state.orders.push({
    _id: payment.serviceId,
    paymentStatus: "Pending",
    status: "Pending",
  });
  const raw = Buffer.from(JSON.stringify({
    id: "evt_test_capture",
    event: "payment.captured",
    payload: { payment: { entity: {
      id: "pay_webhook", order_id: "rzp_webhook_order", amount: 5000,
      currency: "INR", status: "captured", method: "upi",
    } } },
  }));
  const signature = signedPayload(raw, process.env.RAZORPAY_WEBHOOK_SECRET);
  const bad = response();
  await paymentController.webhook({ body: raw, headers: { "x-razorpay-signature": "bad" } }, bad);
  assert.equal(bad.statusCode, 400);
  assert.equal(state.webhookEvents.length, 0);

  const first = response();
  const req = { body: raw, headers: { "x-razorpay-signature": signature, "x-razorpay-event-id": "evt_test_capture" } };
  await paymentController.webhook(req, first);
  assert.equal(first.statusCode, 200);
  assert.equal(payment.status, "Success");
  assert.equal(state.orders[0].status, "Pending");

  const second = response();
  await paymentController.webhook(req, second);
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.status, "already_processed");
  assert.equal(state.webhookEvents.length, 1);
});

test("COD collection requires the owning pharmacy and cannot be collected twice", async () => {
  const pharmacyUser = {
    _id: "666666666666666666666666",
    role: "pharmacy",
    phone: "pharmacy-phone",
  };
  const order = {
    _id: "777777777777777777777777",
    pharmacyId: "pharmacy-id",
    paymentMethod: "COD",
    paymentStatus: "Pending",
    status: "Out for Delivery",
    orderType: "PRESCRIPTION",
    medicines: [{ medicineName: "Medicine", quantity: 1 }],
    totalAmount: 89.5,
    cashCollected: false,
  };
  state.orders.push(order);
  state.pharmacies.push({ _id: order.pharmacyId, phone: pharmacyUser.phone });
  state.users.push(pharmacyUser, patient());

  const unauthorized = response();
  await orderController.collectCODPayment({
    user: { id: patient()._id }, params: { id: order._id }, body: {},
  }, unauthorized);
  assert.equal(unauthorized.statusCode, 403);
  assert.equal(order.cashCollected, false);

  const first = response();
  await orderController.collectCODPayment({
    user: { id: pharmacyUser._id }, params: { id: order._id }, body: { amountPaise: 8950 },
  }, first);
  assert.equal(first.statusCode, 200);
  assert.equal(order.cashCollectedBy, pharmacyUser._id);
  assert.equal(order.cashCollectedAmountPaise, 8950);
  assert.ok(order.cashCollectedAt instanceof Date);

  const duplicate = response();
  await orderController.collectCODPayment({
    user: { id: pharmacyUser._id }, params: { id: order._id }, body: { amountPaise: 8950 },
  }, duplicate);
  assert.equal(duplicate.statusCode, 400);
  assert.equal(order.cashCollectedAmountPaise, 8950);
});
