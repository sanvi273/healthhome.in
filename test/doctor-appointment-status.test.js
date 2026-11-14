const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const userId = "507f1f77bcf86cd799439011";
const doctorId = "507f1f77bcf86cd799439022";
const appointmentId = "507f1f77bcf86cd799439033";

async function updateStatus({ user, doctor }) {
  const state = { appointmentWrites: 0, doctorQuery: null };
  const appointment = {
    _id: appointmentId,
    doctorId,
    doctorName: "Test Doctor",
    status: "Pending",
    paymentStatus: "Paid",
    reports: [{ fileName: "patient-report.jpg", fileUrl: "private-ref" }],
  };
  const stubs = {
    "../models/Appointment": {
      findById: async () => appointment,
      findByIdAndUpdate: async (_id, changes) => {
        state.appointmentWrites += 1;
        Object.assign(appointment, changes);
        return appointment;
      },
    },
    "../models/VideoCallSession": {},
    "../models/user": { findById: async () => user },
    "../models/doctor": {
      findOne: async (query) => {
        state.doctorQuery = query;
        return doctor;
      },
      countDocuments: async () => 1,
    },
    "../utils/patientReportStorage": {
      uploadPatientReport: async () => ({}),
      getPatientReportBytes: async () => ({}),
      isAllowedLegacyCloudinaryUrl: () => false,
    },
    "agora-token": { RtcTokenBuilder: {}, RtcRole: {} },
  };
  const originalLoad = Module._load;
  const controllerPath = require.resolve("../controllers/appointmentController");
  try {
    delete require.cache[controllerPath];
    Module._load = function (request, parent, isMain) {
      if (Object.hasOwn(stubs, request)) return stubs[request];
      return originalLoad.call(this, request, parent, isMain);
    };
    const controller = require("../controllers/appointmentController");
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
    await controller.updateAppointmentStatus(
      { params: { id: appointmentId }, body: { status: "Accepted" }, user: { id: userId } },
      response,
    );
    return { statusCode, body, state, appointment };
  } finally {
    Module._load = originalLoad;
    delete require.cache[controllerPath];
  }
}

test("only the owning approved doctor can accept an appointment", async () => {
  const authorized = await updateStatus({
    user: {
      _id: userId,
      role: "doctor",
      verificationStatus: "APPROVED",
      phone: "919876543210",
    },
    doctor: { _id: doctorId, userId },
  });
  assert.equal(authorized.statusCode, 200);
  assert.equal(authorized.appointment.status, "Accepted");
  assert.equal(authorized.state.appointmentWrites, 1);
  assert.equal(authorized.body.appointment.status, "Accepted");
  assert.equal(authorized.body.appointment.reports, undefined);
  assert.equal(authorized.state.doctorQuery._id, doctorId);

  const patient = await updateStatus({
    user: { _id: userId, role: "patient", phone: "919876543210" },
    doctor: { _id: doctorId, userId },
  });
  assert.equal(patient.statusCode, 403);
  assert.equal(patient.state.appointmentWrites, 0);

  const unrelatedDoctor = await updateStatus({
    user: {
      _id: userId,
      role: "doctor",
      verificationStatus: "APPROVED",
      phone: "919876543210",
    },
    doctor: null,
  });
  assert.equal(unrelatedDoctor.statusCode, 403);
  assert.equal(unrelatedDoctor.state.appointmentWrites, 0);
});
