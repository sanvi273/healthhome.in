const crypto = require("crypto");
const mongoose = require("mongoose");
const Appointment = require("../models/Appointment");
const Doctor = require("../models/doctor");
const User = require("../models/user");
const VideoCallSession = require("../models/VideoCallSession");
const DeviceRegistration = require("../models/DeviceRegistration");
const AuthRateLimit = require("../models/authRateLimit");
const { sendToUser } = require("../services/callPushService");
const { RtcTokenBuilder, RtcRole } = require("agora-token");

const activeStatuses = ["INITIATED", "RINGING", "ACCEPTED", "CONNECTED"];
const normalizePhone = (value) => {
  const digits = String(value || "").replace(/\D/g, "").replace(/^0+/, "");
  return /^91[6-9]\d{9}$/.test(digits) ? digits.slice(2) : digits;
};
const publicCall = (call) => ({
  callId: call.callId,
  appointmentId: String(call.appointmentId),
  channelName: call.channelName,
  status: call.status,
  expiresAt: call.expiresAt,
});

exports.registerDevice = async (req, res) => {
  try {
    const { deviceToken, platform, deviceId = "" } = req.body || {};
    if (typeof deviceToken !== "string" || deviceToken.length < 20 || deviceToken.length > 4096 || !["android", "ios", "web"].includes(platform)) {
      return res.status(400).json({ success: false, message: "A valid FCM device token and platform are required." });
    }
    const user = await User.findById(req.user.id).select("role").lean();
    if (!user || user.role !== req.user.role) return res.status(401).json({ success: false, message: "Authenticated user is unavailable." });
    const tokenOwner = await DeviceRegistration.findOne({ deviceToken }).select("userId").lean();
    if (tokenOwner && String(tokenOwner.userId) !== String(req.user.id)) {
      await DeviceRegistration.deleteOne({ deviceToken });
    }
    const device = await DeviceRegistration.findOneAndUpdate(
      { deviceToken },
      { $set: { userId: req.user.id, role: user.role, platform, deviceId: String(deviceId).slice(0, 160), lastActiveAt: new Date() } },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    );
    return res.json({ success: true, deviceId: String(device._id) });
  } catch (error) {
    console.error("REGISTER CALL DEVICE ERROR:", error.message);
    return res.status(500).json({ success: false, message: "Unable to register this device." });
  }
};

exports.removeDevice = async (req, res) => {
  try {
    const { deviceToken } = req.body || {};
    if (typeof deviceToken !== "string") return res.status(400).json({ success: false, message: "Device token is required." });
    await DeviceRegistration.deleteOne({ userId: req.user.id, deviceToken });
    return res.json({ success: true });
  } catch (error) {
    console.error("REMOVE CALL DEVICE ERROR:", error.message);
    return res.status(500).json({ success: false, message: "Unable to remove this device." });
  }
};

exports.start = async (req, res) => {
  try {
    if (req.user.role !== "doctor") return res.status(403).json({ success: false, message: "Only the appointment doctor can start a consultation." });
    const rateNow = new Date();
    const rate = await AuthRateLimit.findOneAndUpdate(
      { _id: `video-call-start:${req.user.id}` },
      [{ $set: {
        count: { $cond: [{ $gt: ["$expiresAt", rateNow] }, { $add: [{ $ifNull: ["$count", 0] }, 1] }, 1] },
        expiresAt: { $cond: [{ $gt: ["$expiresAt", rateNow] }, "$expiresAt", new Date(rateNow.getTime() + 60_000)] },
      } }],
      { upsert: true, new: true, updatePipeline: true }
    );
    if (rate.count > 5) return res.status(429).json({ success: false, message: "Too many call attempts. Please wait a minute." });
    const { appointmentId } = req.body || {};
    if (!mongoose.isValidObjectId(appointmentId)) return res.status(400).json({ success: false, message: "A valid appointmentId is required." });
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) return res.status(404).json({ success: false, message: "Appointment not found." });
    const [doctorProfile, authenticatedDoctor] = await Promise.all([
      Doctor.findById(appointment.doctorId).select("userId phone").lean(),
      User.findById(req.user.id).select("phone").lean(),
    ]);
    const profileUserMatches = doctorProfile?.userId && String(doctorProfile.userId) === String(req.user.id);
    const legacyPhoneMatches = doctorProfile && authenticatedDoctor &&
      normalizePhone(doctorProfile.phone) !== "" &&
      normalizePhone(doctorProfile.phone) === normalizePhone(authenticatedDoctor.phone);
    const directUserIdMatches = String(appointment.doctorId) === String(req.user.id);
    if (!directUserIdMatches && !profileUserMatches && !legacyPhoneMatches) {
      return res.status(403).json({ success: false, message: "This appointment belongs to another doctor." });
    }
    if (appointment.consultationType !== "Video Consultation" || ["Cancelled", "Rejected", "Completed"].includes(appointment.status)) {
      return res.status(409).json({ success: false, message: "This appointment is not eligible for a video consultation." });
    }
    let patient = appointment.patientId ? await User.findById(appointment.patientId).select("_id name profileImage role").lean() : null;
    if (!patient && appointment.patientPhone) patient = await User.findOne({ phone: appointment.patientPhone, role: "patient" }).select("_id name profileImage role").lean();
    if (!patient || patient.role !== "patient") return res.status(409).json({ success: false, message: "The appointment does not have a registered patient account." });

    await VideoCallSession.updateMany({ appointmentId, status: "RINGING", expiresAt: { $lte: new Date() } }, { $set: { status: "MISSED", endedAt: new Date() }, $unset: { activeAppointmentId: 1 } });
    await VideoCallSession.updateMany({ appointmentId, status: { $in: ["ACCEPTED", "CONNECTED"] }, expiresAt: { $lte: new Date() } }, { $set: { status: "ENDED", endedAt: new Date() }, $unset: { activeAppointmentId: 1 } });
    let call = await VideoCallSession.findOne({ appointmentId, status: { $in: activeStatuses }, expiresAt: { $gt: new Date() } });
    if (!call) {
      const now = new Date();
      const callId = crypto.randomUUID();
      const channelName = `hh-${appointment._id}-${crypto.randomBytes(5).toString("hex")}`;
      try {
        call = await VideoCallSession.create({ appointmentId, doctorId: req.user.id, patientId: patient._id, callId, channelName, status: "RINGING", initiatedAt: now, ringingAt: now, expiresAt: new Date(now.getTime() + 45_000), activeAppointmentId: appointment._id });
      } catch (error) {
        if (error.code !== 11000) throw error;
        call = await VideoCallSession.findOne({ appointmentId, status: { $in: activeStatuses }, expiresAt: { $gt: new Date() } });
        if (!call) throw error;
      }
    }
    const doctor = await User.findById(req.user.id).select("name profileImage").lean();
    let push = { delivered: 0, reason: "No registered patient device" };
    const shouldSendPush = call.status === "RINGING" && await VideoCallSession.findOneAndUpdate({ _id: call._id, pushSentAt: { $exists: false } }, { $set: { pushSentAt: new Date() } }, { new: false });
    if (shouldSendPush) {
      try {
        push = await sendToUser(patient._id, { type: "incoming_call", callId: call.callId, appointmentId: String(appointment._id), doctorName: doctor?.name || appointment.doctorName, doctorImage: doctor?.profileImage || "", expiresAt: call.expiresAt.toISOString() });
        if (!push.delivered) {
          await VideoCallSession.updateOne({ _id: call._id }, { $unset: { pushSentAt: 1 } });
        }
      } catch (error) {
        console.error("INCOMING CALL PUSH ERROR:", error.message);
        await VideoCallSession.updateOne({ _id: call._id }, { $unset: { pushSentAt: 1 } });
        const credentialError = /credential|default app|private key|service account/i.test(error.message || "");
        push = {
          delivered: 0,
          reason: credentialError
            ? "Firebase Admin credentials are missing or invalid on the backend."
            : "Firebase could not deliver the call push. Check backend logs and the patient device registration.",
        };
      }
    }
    appointment.meetingId = call.channelName;
    appointment.consultationStatus = "Ready";
    if (appointment.status === "Pending") appointment.status = "Upcoming";
    await appointment.save();
    return res.status(200).json({ success: true, message: push.delivered ? "Patient is being called." : "Call created, but no patient device received the push.", appointment, call: publicCall(call), push });
  } catch (error) {
    console.error("START VIDEO CALL ERROR:", error.message);
    return res.status(500).json({ success: false, message: "Unable to start this video call." });
  }
};

exports.accept = async (req, res) => transition(req, res, "ACCEPTED", "acceptedAt", "patient");
exports.decline = async (req, res) => transition(req, res, "DECLINED", "declinedAt", "patient");
exports.end = async (req, res) => transition(req, res, "ENDED", "endedAt", "participant");
exports.cancel = async (req, res) => transition(req, res, "CANCELLED", "endedAt", "doctor");

async function transition(req, res, status, timestamp, actor) {
  try {
    const call = await VideoCallSession.findOne({ callId: req.params.callId });
    if (!call) return res.status(404).json({ success: false, message: "Call not found." });
    const userId = String(req.user.id);
    const isDoctor = userId === String(call.doctorId) && req.user.role === "doctor";
    const isPatient = userId === String(call.patientId) && req.user.role === "patient";
    if ((actor === "doctor" && !isDoctor) || (actor === "patient" && !isPatient) || (actor === "participant" && !isDoctor && !isPatient)) return res.status(403).json({ success: false, message: "You are not a participant in this call." });
    if (call.status === status) return res.json({ success: true, call: publicCall(call), duplicate: true });
    if (call.expiresAt <= new Date() && call.status === "RINGING") {
      await VideoCallSession.updateOne({ _id: call._id, status: "RINGING" }, { $set: { status: "MISSED", endedAt: new Date() }, $unset: { activeAppointmentId: 1 } });
      return res.status(410).json({ success: false, message: "This call has expired." });
    }
    const allowed = status === "ACCEPTED" || status === "DECLINED" ? ["RINGING"] : ["INITIATED", "RINGING", "ACCEPTED", "CONNECTED"];
    const now = new Date();
    const updated = await VideoCallSession.findOneAndUpdate({ _id: call._id, status: { $in: allowed }, ...(status === "ACCEPTED" ? { expiresAt: { $gt: now } } : {}) }, { $set: { status, [timestamp]: now, ...(status === "ACCEPTED" ? { expiresAt: new Date(now.getTime() + 90 * 60_000) } : {}) }, ...(status === "DECLINED" || status === "ENDED" ? { $unset: { activeAppointmentId: 1 } } : {}) }, { new: true });
    if (!updated) return res.status(409).json({ success: false, message: "Call is no longer in a state that allows this action." });
    if (["DECLINED", "ENDED", "CANCELLED"].includes(status)) {
      const target = isPatient ? call.doctorId : call.patientId;
      try { await sendToUser(target, { type: status.toLowerCase(), callId: call.callId, appointmentId: String(call.appointmentId) }); } catch (error) { console.error("CALL STATUS PUSH ERROR:", error.message); }
    }
    return res.json({ success: true, call: publicCall(updated) });
  } catch (error) {
    console.error("CALL TRANSITION ERROR:", error.message);
    return res.status(500).json({ success: false, message: "Unable to update call status." });
  }
}

exports.get = async (req, res) => {
  try {
    const call = await VideoCallSession.findOne({ callId: req.params.callId }).lean();
    if (!call) return res.status(404).json({ success: false, message: "Call not found." });
    if (![String(call.doctorId), String(call.patientId)].includes(String(req.user.id))) return res.status(403).json({ success: false, message: "You are not a participant in this call." });
    return res.json({ success: true, call: publicCall(call) });
  } catch (error) { return res.status(500).json({ success: false, message: "Unable to load call status." }); }
};

exports.active = async (req, res) => {
  try {
    const field = req.user.role === "doctor" ? "doctorId" : "patientId";
    const calls = await VideoCallSession.find({ [field]: req.user.id, status: { $in: activeStatuses }, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).limit(10).lean();
    const enrichedCalls = await Promise.all(calls.map(async (call) => {
      const result = publicCall(call);
      if (req.user.role === "patient") {
        const appointment = await Appointment.findById(call.appointmentId).select("doctorName").lean();
        result.doctorName = appointment?.doctorName || "Your doctor";
      }
      return result;
    }));
    return res.json({ success: true, calls: enrichedCalls });
  } catch (error) { return res.status(500).json({ success: false, message: "Unable to load active calls." }); }
};

exports.join = async (req, res) => {
  try {
    const call = await VideoCallSession.findOne({ callId: req.params.callId });
    if (!call) return res.status(404).json({ success: false, message: "Call not found." });
    const id = String(req.user.id);
    const doctor = req.user.role === "doctor" && id === String(call.doctorId);
    const patient = req.user.role === "patient" && id === String(call.patientId);
    if (!doctor && !patient) return res.status(403).json({ success: false, message: "You are not a participant in this call." });
    if (call.expiresAt <= new Date() || !["RINGING", "ACCEPTED", "CONNECTED"].includes(call.status) || (patient && call.status === "RINGING")) return res.status(409).json({ success: false, message: "Accept the active call before joining." });
    const appId = process.env.AGORA_APP_ID;
    const certificate = process.env.AGORA_APP_CERTIFICATE;
    if (!appId || !certificate) return res.status(503).json({ success: false, message: "Agora is not configured on the server." });
    const uid = (parseInt(crypto.createHash("sha256").update(id).digest("hex").slice(0, 7), 16) % 2_000_000_000) + 1;
    const expiry = Math.floor(Date.now() / 1000) + 300;
    const token = RtcTokenBuilder.buildTokenWithUid(appId, certificate, call.channelName, uid, RtcRole.PUBLISHER, expiry, expiry);
    if (patient && call.status === "ACCEPTED") await VideoCallSession.updateOne({ _id: call._id, status: "ACCEPTED" }, { $set: { status: "CONNECTED" } });
    return res.json({ success: true, appId, channelName: call.channelName, uid, token, expiresAt: expiry });
  } catch (error) {
    console.error("JOIN VIDEO CALL ERROR:", error.message);
    return res.status(500).json({ success: false, message: "Unable to join this video call." });
  }
};
