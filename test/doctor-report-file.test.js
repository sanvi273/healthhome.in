const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const doctorUserId = "507f1f77bcf86cd799439011";
const doctorProfileId = "507f1f77bcf86cd799439022";
const appointmentId = "507f1f77bcf86cd799439033";
const reportId = "507f1f77bcf86cd799439044";
const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb]);

async function callReportFile({ doctorProfile, requestedReportId = reportId }) {
  const state = { storageCalls: 0, doctorQuery: null };
  const appointment = {
    doctorId: doctorProfileId,
    doctorName: "Test Doctor",
    reports: [
      {
        _id: reportId,
        fileName: "scan.jpg",
        storagePublicId: "appointment_reports/scan",
        resourceType: "image",
        fileFormat: "jpg",
        toObject() {
          return { ...this };
        },
      },
    ],
  };
  const stubs = {
    "../models/Appointment": {
      findById: () => ({ select: async () => appointment }),
    },
    "../models/VideoCallSession": {},
    "../models/user": {
      findById: async () => ({
        _id: doctorUserId,
        role: "doctor",
        verificationStatus: "APPROVED",
        phone: "919876543210",
      }),
    },
    "../models/doctor": {
      findOne: async (query) => {
        state.doctorQuery = query;
        return doctorProfile;
      },
      countDocuments: async () => 1,
    },
    "../utils/patientReportStorage": {
      uploadPatientReport: async () => ({}),
      isAllowedLegacyCloudinaryUrl: () => false,
      getPatientReportBytes: async () => {
        state.storageCalls += 1;
        return { bytes, fileType: "image/jpeg" };
      },
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
    let responseBytes;
    const headers = {};
    const response = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(value) {
        body = value;
        return this;
      },
      set(name, value) {
        headers[name] = value;
        return this;
      },
      end(value) {
        responseBytes = value;
        return this;
      },
    };

    await controller.getDoctorAppointmentReportFile(
      {
        params: { appointmentId, reportId: requestedReportId },
        user: { id: doctorUserId },
      },
      response,
    );
    return { statusCode, body, responseBytes, headers, state };
  } finally {
    Module._load = originalLoad;
    delete require.cache[controllerPath];
  }
}

test("only the owning approved doctor receives report bytes", async () => {
  const authorized = await callReportFile({
    doctorProfile: { _id: doctorProfileId, userId: doctorUserId },
  });
  assert.equal(authorized.statusCode, 200);
  assert.deepEqual(authorized.responseBytes, bytes);
  assert.equal(authorized.headers["Content-Type"], "image/jpeg");
  assert.equal(authorized.headers["Cache-Control"], "private, no-store");
  assert.equal(authorized.headers["X-Content-Type-Options"], "nosniff");
  assert.equal(authorized.state.storageCalls, 1);

  const unauthorized = await callReportFile({ doctorProfile: null });
  assert.equal(unauthorized.statusCode, 403);
  assert.equal(unauthorized.state.storageCalls, 0);
});

test("does not retrieve bytes for a report ID outside the appointment", async () => {
  const result = await callReportFile({
    doctorProfile: { _id: doctorProfileId, userId: doctorUserId },
    requestedReportId: "507f1f77bcf86cd799439099",
  });
  assert.equal(result.statusCode, 404);
  assert.equal(result.state.storageCalls, 0);
});
