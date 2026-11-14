const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Module = require("node:module");

const patientId = "507f1f77bcf86cd799439011";
const doctorId = "507f1f77bcf86cd799439022";
const appointmentId = "507f1f77bcf86cd799439033";
const razorpayOrderId = "order_test_1";
const razorpayPaymentId = "pay_test_1";
const razorpaySecret = "appointment-test-secret";
const webhookSecret = "appointment-webhook-secret";

test("paid doctor bookings stay pending until a doctor accepts them", async () => {
  const previousEnv = {
    RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET,
  };
  process.env.RAZORPAY_KEY_ID = "rzp_test_key";
  process.env.RAZORPAY_KEY_SECRET = razorpaySecret;
  process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;

  const state = {
    appointment: null,
    paymentRecord: null,
    paymentUpdate: null,
    webhookAppointmentUpdate: null,
  };
  const patient = {
    _id: patientId,
    name: "Test Patient",
    phone: "9313069960",
    role: "patient",
    accountStatus: "ACTIVE",
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
        create: async (order) => ({
          id: razorpayOrderId,
          amount: order.amount,
          currency: order.currency,
          status: "created",
        }),
      };
      this.payments = {
        fetch: async (id) => ({
          id,
          order_id: razorpayOrderId,
          amount: 50000,
          currency: "INR",
          status: "captured",
          method: "upi",
        }),
      };
    }
  }

  const fakeMongoose = {
    Types: { ObjectId: FakeObjectId },
    connection: {
      collection: () => ({
        findOne: async () => ({
          _id: doctorId,
          name: "Test Doctor",
          fees: 500,
          specialization: "General Medicine",
          hospital: "Test Clinic",
        }),
      }),
    },
  };

  const modelStubs = {
    "../models/Payment": {
      create: async (data) => {
        state.paymentRecord = {
          ...data,
          _id: "507f1f77bcf86cd799439044",
          save: async () => {},
        };
        return state.paymentRecord;
      },
      findOneAndUpdate: async (_query, update) => {
        state.paymentUpdate = update;
        Object.assign(state.paymentRecord, update.$set);
        return state.paymentRecord;
      },
      findOne: async (query) =>
        query?.webhookEventId ? null : state.paymentRecord,
      updateMany: async () => ({ modifiedCount: 0 }),
    },
    "../models/orderModel": {},
    "../models/Appointment": {
      find: async () => [],
      findOne: () => ({ lean: async () => null }),
      create: async (data) => {
        state.appointment = {
          ...data,
          _id: appointmentId,
          save: async () => {},
          toObject() {
            const { save, toObject, ...plain } = this;
            return plain;
          },
        };
        return state.appointment;
      },
      findById: async () => state.appointment,
      findByIdAndUpdate: async (_id, update) => {
        state.webhookAppointmentUpdate = update;
        Object.assign(state.appointment, update.$set);
        return state.appointment;
      },
      updateMany: async () => ({ modifiedCount: 0 }),
    },
    "../models/user": { findById: async () => patient },
    "../utils/cloudinaryUpload": async () => ({}),
    "../utils/patientReportStorage": { uploadPatientReport: async () => ({}) },
  };

  const originalLoad = Module._load;
  const controllerPath = require.resolve("../controllers/paymentController");
  try {
    delete require.cache[controllerPath];
    Module._load = function (request, parent, isMain) {
      if (request === "mongoose") return fakeMongoose;
      if (request === "razorpay") return FakeRazorpay;
      if (Object.hasOwn(modelStubs, request)) return modelStubs[request];
      return originalLoad.call(this, request, parent, isMain);
    };

    const controller = require("../controllers/paymentController");
    const orderResponse = await invokeJson(controller.createDoctorOrder, {
      user: { id: patientId },
      body: {
        doctorId,
        doctorName: "Test Doctor",
        appointmentDate: "2026-12-01",
        appointmentTime: "10:00 AM",
        consultationType: "Video Consultation",
      },
      files: [],
    });

    assert.equal(orderResponse.statusCode, 200);
    assert.equal(orderResponse.body.success, true);
    assert.equal(orderResponse.body.appointment.patientId, patientId);
    assert.equal(orderResponse.body.appointment.doctorId, doctorId);
    assert.equal(orderResponse.body.appointment.status, "Pending");
    assert.equal(orderResponse.body.appointment.paymentStatus, "Pending");
    assert.equal(state.paymentRecord.serviceId, appointmentId);

    const signature = crypto
      .createHmac("sha256", razorpaySecret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest("hex");
    const paymentResponse = await invokeJson(controller.verifyDoctorPayment, {
      body: {
        appointmentId,
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: signature,
      },
    });

    assert.equal(paymentResponse.statusCode, 200);
    assert.equal(paymentResponse.body.paymentVerified, true);
    assert.equal(state.appointment.paymentStatus, "Paid");
    assert.equal(state.appointment.status, "Pending");

    const event = {
      id: "evt_test_1",
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: razorpayPaymentId,
            order_id: razorpayOrderId,
            method: "upi",
          },
        },
      },
    };
    const rawBody = Buffer.from(JSON.stringify(event));
    const webhookSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");
    const webhookResponse = await invokeJson(
      controller.webhook,
      {
        body: rawBody,
        headers: {
          "x-razorpay-signature": webhookSignature,
          "x-razorpay-event-id": "evt_test_1",
        },
      },
    );

    assert.equal(webhookResponse.statusCode, 200);
    assert.equal(state.webhookAppointmentUpdate.$set.paymentStatus, "Paid");
    assert.equal(Object.hasOwn(state.webhookAppointmentUpdate.$set, "status"), false);
    assert.equal(state.appointment.status, "Pending");
  } finally {
    Module._load = originalLoad;
    delete require.cache[controllerPath];
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

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
