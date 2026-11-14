const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

test("doctor appointment checkout stores authenticated report references", async () => {
  const previousEnv = {
    RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET,
  };
  process.env.RAZORPAY_KEY_ID = "rzp_test_key";
  process.env.RAZORPAY_KEY_SECRET = "test_secret";
  process.env.RAZORPAY_WEBHOOK_SECRET = "test_webhook_secret";

  const patient = {
    _id: "507f1f77bcf86cd799439011",
    name: "Test Patient",
    phone: "9313069960",
    role: "patient",
    accountStatus: "ACTIVE",
  };
  const doctorId = "507f1f77bcf86cd799439022";
  const state = { appointment: null, uploadedFiles: [] };
  const modelStubs = {
    "../models/Payment": { create: async () => ({}) },
    "../models/orderModel": {},
    "../models/Appointment": {
      find: async () => [],
      findOne: () => ({ lean: async () => null }),
      create: async (data) => {
        state.appointment = {
          ...data,
          _id: "507f1f77bcf86cd799439033",
          save: async () => {},
        };
        return state.appointment;
      },
    },
    "../models/user": { findById: async () => patient },
    "../utils/cloudinaryUpload": async (file, folder, options) => {
      state.uploadedFiles.push({ file, folder, options });
      return {
        secure_url: "https://res.cloudinary.com/healthhome/image/authenticated/report.jpg",
        public_id: "appointment_reports/report",
        resource_type: "image",
        format: "jpg",
      };
    },
    "../utils/patientReportStorage": {
      uploadPatientReport: async (file) => {
        const uploaded = await modelStubs["../utils/cloudinaryUpload"](
          file,
          "appointment_reports",
          { type: "authenticated" },
        );
        return {
          fileName: file.originalname,
          fileType: "image/jpeg",
          storagePublicId: uploaded.public_id,
          resourceType: uploaded.resource_type,
          fileFormat: uploaded.format,
          uploadedAt: new Date(),
        };
      },
    },
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
        create: async () => ({ id: "order_doctor_1" }),
      };
    }
  }

  const fakeMongoose = {
    Types: { ObjectId: FakeObjectId },
    connection: {
      collection: () => ({
        findOne: async () => ({ name: "Test Doctor", fees: 500 }),
      }),
    },
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
    let statusCode;
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

    await controller.createDoctorOrder(
      {
        user: { id: patient._id },
        body: {
          doctorId,
          appointmentDate: "2026-12-01",
          appointmentTime: "10:00 AM",
          consultationType: "Video Consultation",
        },
        files: [
          {
            originalname: "blood-test.jpg",
            mimetype: "image/jpeg",
            buffer: Buffer.from([0xff, 0xd8, 0xff, 0xdb]),
          },
        ],
      },
      response,
    );

    assert.equal(statusCode, 200, JSON.stringify(body));
    assert.equal(state.uploadedFiles.length, 1);
    assert.equal(state.uploadedFiles[0].folder, "appointment_reports");
    assert.deepEqual(state.uploadedFiles[0].options, { type: "authenticated" });
    assert.equal(state.appointment.reports[0].fileUrl, undefined);
    assert.equal(
      state.appointment.reports[0].storagePublicId,
      "appointment_reports/report",
    );
    assert.equal(state.appointment.reports[0].fileName, "blood-test.jpg");
    assert.equal(body.appointment.reports, undefined);
  } finally {
    Module._load = originalLoad;
    delete require.cache[controllerPath];
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
