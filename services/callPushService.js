const DeviceRegistration = require("../models/DeviceRegistration");

let firebaseAdmin;
try {
  firebaseAdmin = require("firebase-admin");
} catch (_) {
  firebaseAdmin = null;
}

function getMessaging() {
  if (!firebaseAdmin) throw new Error("firebase-admin is not installed");
  if (!firebaseAdmin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (raw) {
      firebaseAdmin.initializeApp({ credential: firebaseAdmin.credential.cert(JSON.parse(raw)) });
    } else {
      firebaseAdmin.initializeApp({ credential: firebaseAdmin.credential.applicationDefault() });
    }
  }
  return firebaseAdmin.messaging();
}

async function sendToUser(userId, payload) {
  const devices = await DeviceRegistration.find({ userId }).select("deviceToken").lean();
  if (!devices.length) return { delivered: 0, reason: "No registered devices" };
  const messaging = getMessaging();
  const response = await messaging.sendEachForMulticast({
    tokens: devices.map((device) => device.deviceToken),
    data: Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, String(value ?? "")])),
    // Include a native Android notification as well as data. Android can show
    // this when ColorOS delays Flutter's background isolate; tapping it opens
    // the app with the same call data for the existing incoming-call flow.
    notification: payload.type === "incoming_call" ? {
      title: "Incoming video consultation",
      body: `${payload.doctorName || "Your doctor"} is ready to consult. Tap to answer.`,
    } : undefined,
    android: {
      priority: "high",
      ttl: 45000,
      collapseKey: `healthhome-call-${payload.callId || payload.appointmentId || "incoming"}`,
      notification: payload.type === "incoming_call" ? {
        channelId: "incoming_calls",
        sound: "default",
        priority: "max",
        visibility: "public",
        defaultVibrateTimings: true,
        tag: `healthhome-call-${payload.callId || payload.appointmentId || "incoming"}`,
      } : undefined,
    },
    apns: { headers: { "apns-priority": "10", "apns-push-type": "alert", "apns-expiration": String(Math.floor(Date.now() / 1000) + 45) }, payload: { aps: { alert: { title: "Incoming video consultation", body: "Your doctor is ready to consult." }, sound: "default", category: "INCOMING_CALL", "content-available": 1 } } },
  });
  const invalid = [];
  response.responses.forEach((result, index) => {
    if (!result.success && ["messaging/invalid-registration-token", "messaging/registration-token-not-registered"].includes(result.error?.code)) invalid.push(devices[index].deviceToken);
  });
  if (invalid.length) await DeviceRegistration.deleteMany({ deviceToken: { $in: invalid } });
  return { delivered: response.successCount, failed: response.failureCount };
}

module.exports = { sendToUser };
