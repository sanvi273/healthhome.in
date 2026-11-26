const firebaseAdmin = require("firebase-admin");

const DEFAULT_FIREBASE_PROJECT_ID = "healthhome-c6346";

function expectedProjectId() {
  return process.env.FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_PROJECT_ID;
}

function getFirebaseAuth() {
  const projectId = expectedProjectId();
  let app = firebaseAdmin.apps[0];

  if (!app) {
    const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    let credential;

    if (rawServiceAccount) {
      let serviceAccount;
      try {
        serviceAccount = JSON.parse(rawServiceAccount);
      } catch (_) {
        const error = new Error("Firebase Admin credentials are not valid JSON.");
        error.code = "FIREBASE_ADMIN_CONFIG";
        throw error;
      }

      if (serviceAccount.project_id && serviceAccount.project_id !== projectId) {
        const error = new Error("Firebase Admin credentials use a different project.");
        error.code = "FIREBASE_ADMIN_PROJECT_MISMATCH";
        throw error;
      }
      try {
        credential = firebaseAdmin.credential.cert(serviceAccount);
      } catch (cause) {
        const error = new Error("Firebase Admin credentials are unavailable.");
        error.code = "FIREBASE_ADMIN_UNAVAILABLE";
        error.cause = cause;
        throw error;
      }
    }

    try {
      credential ??= firebaseAdmin.credential.applicationDefault();
      app = firebaseAdmin.initializeApp({ credential, projectId });
    } catch (cause) {
      const error = new Error("Firebase Admin credentials are unavailable.");
      error.code = "FIREBASE_ADMIN_UNAVAILABLE";
      error.cause = cause;
      throw error;
    }
  }

  const configuredProject = app.options.projectId;
  if (configuredProject && configuredProject !== projectId) {
    const error = new Error("Firebase Admin is initialized for a different project.");
    error.code = "FIREBASE_ADMIN_PROJECT_MISMATCH";
    throw error;
  }

  return firebaseAdmin.auth(app);
}

function normalizeVerifiedPhone(phoneNumber) {
  const value = String(phoneNumber || "").trim().replace(/[\s().-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(value)) return null;
  const digits = value.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? `91${digits}` : digits;
}

function phoneLookupQuery(normalizedPhone) {
  const variants = new Set([normalizedPhone, `+${normalizedPhone}`]);
  if (/^91[6-9]\d{9}$/.test(normalizedPhone)) {
    variants.add(normalizedPhone.slice(2));
  }
  const formattedVariants = [...variants].map((variant) => {
    const digits = variant.replace(/\D/g, "");
    return new RegExp(`^\\+?${digits.split("").join("[\\s().-]*")}$`);
  });
  return { $in: [...variants, ...formattedVariants] };
}

function phoneForStorage(normalizedPhone) {
  return /^91[6-9]\d{9}$/.test(normalizedPhone)
    ? normalizedPhone.slice(2)
    : `+${normalizedPhone}`;
}

async function verifyFirebaseIdToken(idToken) {
  if (typeof idToken !== "string" || idToken.length < 20 || idToken.length > 8192) {
    const error = new Error("A valid Firebase ID token is required.");
    error.code = "FIREBASE_ID_TOKEN_INVALID";
    throw error;
  }

  let decoded;
  try {
    decoded = await getFirebaseAuth().verifyIdToken(idToken, true);
  } catch (error) {
    if ([
      "app/no-app",
      "app/invalid-credential",
      "auth/invalid-credential",
      "auth/insufficient-permission",
      "auth/project-not-found",
    ].includes(error.code)) {
      const configError = new Error("Firebase Admin credentials are unavailable.");
      configError.code = "FIREBASE_ADMIN_UNAVAILABLE";
      configError.cause = error;
      throw configError;
    }
    throw error;
  }
  const normalizedPhone = normalizeVerifiedPhone(decoded.phone_number);
  if (!decoded.uid || !normalizedPhone) {
    const error = new Error("The Firebase account does not have a verified phone number.");
    error.code = "FIREBASE_PHONE_MISSING";
    throw error;
  }

  return {
    uid: decoded.uid,
    phoneNumber: `+${normalizedPhone}`,
    normalizedPhone,
    storedPhone: phoneForStorage(normalizedPhone),
  };
}

module.exports = {
  getFirebaseAuth,
  normalizeVerifiedPhone,
  phoneLookupQuery,
  phoneForStorage,
  verifyFirebaseIdToken,
};
