const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const doctorId = "507f1f77bcf86cd799439022";
const userId = "507f1f77bcf86cd799439011";

async function invokeDoctorAppointments({
  user,
  doctor,
  appointments = [],
  patients = [],
  doctorNameCount = 1,
}) {
  const state = { query: null, doctorQuery: null, patientQuery: null };
  const stubs = {
    "../models/Appointment": {
      find(query) {
        state.query = query;
        return { sort: async () => appointments };
      },
      findById: async () => null,
    },
    "../models/VideoCallSession": {},
    "../models/user": {
      findById: async () => user,
      find(query) {
        state.patientQuery = query;
        return {
          select() {
            return { lean: async () => patients };
          },
        };
      },
    },
    "../models/doctor": {
      findOne: async (query) => {
        state.doctorQuery = query;
        return doctor;
      },
      countDocuments: async () => doctorNameCount,
    },
    "../utils/cloudinaryUpload": async () => ({}),
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

    await controller.getDoctorAppointments(
      { params: { doctorId }, user: { id: userId } },
      response,
    );
    return { statusCode, body, state };
  } finally {
    Module._load = originalLoad;
    delete require.cache[controllerPath];
  }
}

test("doctor schedule exposes report metadata without storage URLs", async () => {
  const result = await invokeDoctorAppointments({
    user: {
      _id: userId,
      role: "doctor",
      verificationStatus: "APPROVED",
      phone: "919876543210",
    },
    doctor: { _id: doctorId, name: "Test Doctor" },
    appointments: [
      {
        _id: "507f1f77bcf86cd799439033",
        patientId: "507f1f77bcf86cd799439044",
        reports: [
          {
            _id: "507f1f77bcf86cd799439055",
            fileName: "report.jpg",
            fileType: "image/jpeg",
            fileUrl: "https://res.cloudinary.com/healthhome/private/report.jpg",
            storagePublicId: "appointment_reports/report",
            resourceType: "image",
            fileFormat: "jpg",
          },
        ],
      },
    ],
  });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.appointments[0].reports[0], {
    _id: "507f1f77bcf86cd799439055",
    fileName: "report.jpg",
    fileType: "image/jpeg",
    uploadedAt: null,
    canView: true,
  });
  assert.equal(result.state.query.$or[0].doctorId, doctorId);
  assert.equal(result.state.doctorQuery._id, doctorId);
  assert.equal(result.state.doctorQuery.$or[0].userId, userId);
});

test("doctor appointments include the patient's saved profile photo", async () => {
  const patientPhone = "919876543210";
  const imageUrl = "https://res.cloudinary.com/healthhome/image/upload/patient.jpg";
  const result = await invokeDoctorAppointments({
    user: {
      _id: userId,
      role: "doctor",
      verificationStatus: "APPROVED",
      phone: "918888888888",
    },
    doctor: { _id: doctorId, name: "Test Doctor" },
    appointments: [
      {
        _id: "507f1f77bcf86cd799439033",
        patientId: null,
        patientPhone,
        patientName: "Test Patient",
        reports: [],
      },
    ],
    patients: [
      { _id: "507f1f77bcf86cd799439044", phone: patientPhone, profileImage: imageUrl },
    ],
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.appointments[0].patientProfileImageUrl, imageUrl);
  assert.deepEqual(result.state.patientQuery, {
    role: "patient",
    $or: [{ phone: { $in: [patientPhone] } }],
  });
});

test("doctor schedule rejects non-doctors and doctors without their own profile", async () => {
  const patientResult = await invokeDoctorAppointments({
    user: { _id: userId, role: "patient", phone: "919876543210" },
    doctor: { _id: doctorId, name: "Test Doctor" },
  });
  assert.equal(patientResult.statusCode, 403);
  assert.equal(patientResult.state.query, null);

  const unrelatedDoctorResult = await invokeDoctorAppointments({
    user: {
      _id: userId,
      role: "doctor",
      verificationStatus: "APPROVED",
      phone: "919876543210",
    },
    doctor: null,
  });
  assert.equal(unrelatedDoctorResult.statusCode, 404);
  assert.equal(unrelatedDoctorResult.state.query, null);
});

test("legacy name matching is disabled when doctor names are not unique", async () => {
  const result = await invokeDoctorAppointments({
    user: {
      _id: userId,
      role: "doctor",
      verificationStatus: "APPROVED",
      phone: "919876543210",
    },
    doctor: { _id: doctorId, name: "Shared Name" },
    doctorNameCount: 2,
  });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.state.query.$or, [{ doctorId }]);
});
