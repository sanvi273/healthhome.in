const test = require("node:test");
const assert = require("node:assert/strict");
const VideoCallSession = require("../models/VideoCallSession");

test("video-call sessions require participants, channel and expiry and default to initiated", async () => {
  const call = new VideoCallSession({
    appointmentId: "507f1f77bcf86cd799439011",
    doctorId: "507f1f77bcf86cd799439012",
    patientId: "507f1f77bcf86cd799439013",
    callId: "test-call-id",
    channelName: "hh-test-channel",
    expiresAt: new Date(Date.now() + 45_000),
  });

  await call.validate();
  assert.equal(call.status, "INITIATED");
  assert.equal(call.appointmentId.toString(), "507f1f77bcf86cd799439011");
});

test("video-call sessions reject unknown statuses", async () => {
  const call = new VideoCallSession({
    appointmentId: "507f1f77bcf86cd799439011",
    doctorId: "507f1f77bcf86cd799439012",
    patientId: "507f1f77bcf86cd799439013",
    callId: "test-call-id",
    channelName: "hh-test-channel",
    status: "BOOKED",
    expiresAt: new Date(Date.now() + 45_000),
  });

  await assert.rejects(call.validate(), /status/);
});

test("video-call sessions release the appointment's unique active-call key after end", async () => {
  const indexes = VideoCallSession.schema.indexes();
  assert.ok(indexes.some(([keys, options]) => keys.activeAppointmentId === 1 && options.unique && options.sparse));
});
