const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const User = require("../models/user");
const AuthRateLimit = require("../models/authRateLimit");
const PasswordResetToken = require("../models/passwordResetToken");

const RESET_ROLES = new Set(["patient", "doctor", "laboratory", "pharmacy"]);
const RESET_TTL_MS = 15 * 60 * 1000;
const SMS_FLOW_URL = "https://control.msg91.com/api/v5/flow";

function normalizePhone(input) {
  const value = String(input || "").trim().replace(/[\s()-]/g, "");
  if (!/^\+?[1-9]\d{7,14}$/.test(value)) return null;
  const digits = value.startsWith("+") ? value.slice(1) : value;
  return /^[6-9]\d{9}$/.test(digits) ? `91${digits}` : digits;
}

function phoneQuery(phone) {
  const variants = [phone, `+${phone}`];
  if (/^91[6-9]\d{9}$/.test(phone)) variants.push(phone.slice(2));
  return { $in: variants };
}

function validPassword(password) {
  return typeof password === "string" &&
    password.length >= 8 &&
    password.length <= 128 &&
    /[A-Za-z]/.test(password) &&
    /\d/.test(password);
}

function roleFrom(input) {
  const role = String(input || "").trim().toLowerCase();
  return RESET_ROLES.has(role) ? role : null;
}

async function incrementRateLimit(scope, value, limit) {
  const now = Date.now();
  const bucket = Math.floor(now / (60 * 60 * 1000));
  const valueHash = crypto
    .createHash("sha256")
    .update(`${scope}:${value}`)
    .digest("hex");
  const id = `${scope}:${valueHash}:${bucket}`;
  const expiresAt = new Date((bucket + 1) * 60 * 60 * 1000 + 60 * 1000);
  const counter = await AuthRateLimit.findOneAndUpdate(
    { _id: id },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
    { upsert: true, new: true },
  );
  if (counter.count > limit) throw new Error("RESET_RATE_LIMIT");
}

function publicApiBaseUrl() {
  const configured =
    process.env.PASSWORD_RESET_PUBLIC_API_URL ||
    process.env.PUBLIC_API_BASE_URL ||
    "https://healthhome-in-g4xh.onrender.com";
  return configured.trim().replace(/\/+$/, "");
}

async function sendResetLinkSms(phone, resetUrl) {
  const authKey = process.env.MSG91_AUTH_KEY?.trim();
  const templateId = process.env.MSG91_PASSWORD_RESET_FLOW_ID?.trim();
  if (!authKey || !templateId) {
    throw new Error("PASSWORD_RESET_SMS_NOT_CONFIGURED");
  }

  const response = await fetch(SMS_FLOW_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      authkey: authKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      template_id: templateId,
      short_url: "1",
      short_url_expiry: "900",
      realTimeResponse: "1",
      recipients: [{ mobiles: phone, VAR1: resetUrl }],
    }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json().catch(() => null);
  if (
    !response.ok ||
    !data ||
    data.type === "error" ||
    data.msg_type === "Error" ||
    data.hasError === true ||
    (data.errors && Object.keys(data.errors).length > 0)
  ) {
    throw new Error("PASSWORD_RESET_SMS_DELIVERY_FAILED");
  }
}

const pendingResetJobs = new Set();

async function processPasswordResetRequest(role, phone) {
  const userQuery = User.findOne({
    phone: phoneQuery(phone),
    role,
    accountStatus: { $ne: "SUSPENDED" },
  });
  const user = await userQuery.select("_id role phone accountStatus");
  if (!user) return;

  const now = new Date();
  await PasswordResetToken.updateMany(
    { userId: user._id, role, consumedAt: null },
    { $set: { consumedAt: now } },
  );

  const rawToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");
  await PasswordResetToken.create({
    userId: user._id,
    role,
    tokenHash,
    expiresAt: new Date(now.getTime() + RESET_TTL_MS),
  });

  const resetUrl = new URL(
    "/api/auth/forgot-password/open",
    publicApiBaseUrl(),
  );
  resetUrl.searchParams.set("token", rawToken);
  resetUrl.searchParams.set("role", role);

  try {
    await sendResetLinkSms(phone, resetUrl.toString());
  } catch (error) {
    await PasswordResetToken.updateOne(
      { tokenHash, consumedAt: null },
      { $set: { consumedAt: new Date() } },
    ).catch(() => {});
    console.error("PASSWORD RESET SMS DELIVERY FAILED", {
      failureCode: [
        "PASSWORD_RESET_SMS_NOT_CONFIGURED",
        "PASSWORD_RESET_SMS_DELIVERY_FAILED",
      ].includes(error.message)
        ? error.message
        : "PROVIDER_ERROR",
    });
  }
}

function queuePasswordResetRequest(role, phone) {
  let job;
  job = new Promise((resolve) => setImmediate(resolve))
    .then(() => processPasswordResetRequest(role, phone))
    .catch((error) => {
      console.error("PASSWORD RESET LINK PROCESSING FAILED", {
        errorType: error.name || "RequestError",
      });
    })
    .finally(() => pendingResetJobs.delete(job));
  pendingResetJobs.add(job);
}

exports.flushPendingResetJobs = async () => {
  while (pendingResetJobs.size > 0) {
    await Promise.all([...pendingResetJobs]);
  }
};

exports.requestPasswordReset = async (req, res) => {
  try {
    const role = roleFrom(req.body?.role);
    const phone = normalizePhone(req.body?.phone);
    if (!role || !phone) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid mobile number and supported account type.",
      });
    }

    const ip = String(req.ip || "unknown").slice(0, 64);
    await incrementRateLimit("password-reset-ip", ip, 30);
    await incrementRateLimit("password-reset-phone", `${role}:${phone}`, 3);
    const response = res.status(200).json({
      success: true,
      message:
        "If an account matches those details, a password reset link will be sent by SMS.",
    });
    // Account lookup and SMS delivery happen after the identical response for
    // eligible and ineligible phone/role pairs, limiting timing-based discovery.
    queuePasswordResetRequest(role, phone);
    return response;
  } catch (error) {
    if (error.message === "RESET_RATE_LIMIT") {
      return res.status(429).json({
        success: false,
        message: "Too many reset requests. Please try again later.",
      });
    }
    console.error("PASSWORD RESET LINK REQUEST FAILED", {
      errorType: error.name || "RequestError",
    });
    return res.status(500).json({
      success: false,
      message: "Unable to process the request. Please try again.",
    });
  }
};

exports.completePasswordReset = async (req, res) => {
  try {
    const token = req.body?.resetToken;
    const role = roleFrom(req.body?.role);
    const phone = normalizePhone(req.body?.phone);
    const password = req.body?.password;
    if (
      typeof token !== "string" ||
      !/^[A-Za-z0-9_-]{40,64}$/.test(token) ||
      !role ||
      !phone ||
      !validPassword(password)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Use a valid reset link and a password with at least 8 characters, including a letter and a number.",
      });
    }

    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");
    const now = new Date();
    const resetToken = await PasswordResetToken.findOne({
      tokenHash,
      role,
      consumedAt: null,
      expiresAt: { $gt: now },
    }).lean();
    if (!resetToken) {
      return res.status(401).json({
        success: false,
        message: "This reset link or registered phone number is invalid, expired, or already used.",
      });
    }

    const user = await User.findById(resetToken.userId).select(
      "_id role phone accountStatus password passwordChangedAt",
    );
    const storedPhone = user ? normalizePhone(user.phone) : null;
    if (
      !user ||
      user.role !== role ||
      user.accountStatus === "SUSPENDED" ||
      storedPhone !== phone ||
      (user.passwordChangedAt &&
        resetToken.createdAt &&
        resetToken.createdAt <= user.passwordChangedAt)
    ) {
      return res.status(401).json({
        success: false,
        message: "This reset link or registered phone number is invalid, expired, or already used.",
      });
    }

    // Atomically claim the token so concurrent submissions can only consume it once.
    const claimedToken = await PasswordResetToken.findOneAndUpdate(
      {
        _id: resetToken._id,
        tokenHash,
        role,
        consumedAt: null,
        expiresAt: { $gt: now },
      },
      { $set: { consumedAt: now } },
      { new: true },
    );
    if (!claimedToken) {
      return res.status(401).json({
        success: false,
        message: "This reset link is invalid, expired, or already used.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const updatedUser = await User.findOneAndUpdate(
      {
        _id: user._id,
        role,
        accountStatus: { $ne: "SUSPENDED" },
        passwordChangedAt: user.passwordChangedAt || null,
      },
      { $set: { password: passwordHash, passwordChangedAt: now } },
      { new: true },
    );
    if (!updatedUser) {
      return res.status(401).json({
        success: false,
        message: "This reset link is invalid, expired, or already used.",
      });
    }

    await PasswordResetToken.updateMany(
      { userId: user._id, role, consumedAt: null },
      { $set: { consumedAt: now } },
    );

    return res.status(200).json({
      success: true,
      message: "Password updated successfully.",
    });
  } catch (error) {
    console.error("PASSWORD RESET COMPLETION FAILED", {
      errorType: error.name || "RequestError",
    });
    return res.status(500).json({
      success: false,
      message: "Unable to update password. Please request a new link.",
    });
  }
};

exports.openPasswordResetPage = async (req, res) => {
  const token = String(req.query?.token || "");
  const role = roleFrom(req.query?.role);
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token) || !role) {
    return res.status(400).type("text/plain").send("This reset link is invalid.");
  }

  const tokenHash = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
  const activeToken = await PasswordResetToken.findOne({
    tokenHash,
    role,
    consumedAt: null,
    expiresAt: { $gt: new Date() },
  }).select("_id").lean();
  if (!activeToken) {
    return res.status(400).type("text/plain").send(
      "This reset link is expired or already used. Request a new password reset link.",
    );
  }

  const roleColor = {
    patient: "#00C2CB",
    doctor: "#14B8A6",
    laboratory: "#20C6D3",
    pharmacy: "#14B8A6",
  }[role];

  res.set({
    "Cache-Control": "no-store, max-age=0",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Reset HealthHome password</title>
<style>
:root{--primary:${roleColor};font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#211d25;background:#eaf7ed}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px}.card{width:min(100%,520px);background:#f8f3f9;border:1px solid #e8dfea;border-radius:26px;padding:28px;box-shadow:0 12px 36px #18351c24}.icon{width:72px;height:72px;margin:0 auto 16px;color:var(--primary)}h1{font-size:26px;margin:0 0 10px;text-align:center}p{line-height:1.55;color:#4f4953;text-align:center}.field{display:flex;align-items:center;gap:8px}.field input{flex:1;min-width:0}.toggle{width:auto;margin:0;padding:8px 10px;border:0;background:transparent;color:#514a55}.field input{width:100%;padding:15px;border:1px solid #817a84;border-radius:16px;font:inherit}label{display:block;font-weight:600;margin:18px 0 8px}button,.app-link{display:block;width:100%;margin-top:18px;padding:15px;border:0;border-radius:12px;background:var(--primary);color:white;text-align:center;text-decoration:none;font:600 16px system-ui;cursor:pointer}button:disabled{opacity:.6}.error{color:#b42318}.muted{font-size:13px}.hidden{display:none}
</style>
</head>
<body><main class="card">
<svg class="icon" viewBox="0 0 80 80" fill="none" aria-hidden="true"><path d="M15 36a26 26 0 1 1 8 25" stroke="currentColor" stroke-width="8" stroke-linecap="round"/><path d="M6 34l9 12 10-11" fill="currentColor"/><rect x="33" y="36" width="22" height="20" rx="4" fill="currentColor"/><path d="M38 36v-5a6 6 0 0 1 12 0v5" stroke="currentColor" stroke-width="4"/></svg>
<h1 id="title">Reset Password</h1>
<p id="description">Enter your registered phone number and create a new password.</p>
<form id="form">
<label for="phone">Registered Phone Number</label><input id="phone" type="tel" inputmode="tel" autocomplete="tel" required>
<label for="password">New Password</label><div class="field"><input id="password" type="password" autocomplete="new-password" required minlength="8" maxlength="128"><button class="toggle" type="button" data-target="password">Show</button></div>
<label for="confirm">Confirm Password</label><div class="field"><input id="confirm" type="password" autocomplete="new-password" required minlength="8" maxlength="128"><button class="toggle" type="button" data-target="confirm">Show</button></div>
<p class="muted">Use at least 8 characters, including a letter and a number.</p>
<p id="error" class="error hidden" role="alert"></p>
<button id="submit" type="submit">Update Password</button>
</form>
<section id="success" class="hidden">
<h1>Password Updated Successfully</h1>
<p>Your password has been changed successfully. You can now log in using your new password.</p>
<a class="app-link" id="login-link" href="#">Back to Login</a>
</section>
<a class="app-link" id="open-app" href="#">Open in HealthHome app</a>
</main>
<script>
const token=${JSON.stringify(token)}, role=${JSON.stringify(role)};
const appLink=(path)=>'healthhome://'+path+'?role='+encodeURIComponent(role)+(path==='reset-password'?'&token='+encodeURIComponent(token):'');
document.getElementById('open-app').href=appLink('reset-password');
document.getElementById('login-link').href=appLink('login');
document.querySelectorAll('.toggle').forEach((toggle)=>toggle.addEventListener('click',()=>{const field=document.getElementById(toggle.dataset.target);const showing=field.type==='password';field.type=showing?'text':'password';toggle.textContent=showing?'Hide':'Show'}));
document.getElementById('form').addEventListener('submit',async(event)=>{
event.preventDefault();const phone=document.getElementById('phone').value.trim();const password=document.getElementById('password').value;const confirm=document.getElementById('confirm').value;const error=document.getElementById('error');const button=document.getElementById('submit');
error.classList.add('hidden');if(password!==confirm){error.textContent='Passwords do not match.';error.classList.remove('hidden');return}
if(password.length<8||password.length>128||!/[A-Za-z]/.test(password)||!/[0-9]/.test(password)){error.textContent='Use at least 8 characters, including a letter and a number.';error.classList.remove('hidden');return}
button.disabled=true;button.textContent='Updating…';try{const response=await fetch('/api/auth/reset-password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({resetToken:token,role,phone,password})});const data=await response.json();if(!response.ok||data.success!==true)throw new Error(data.message||'Unable to update password.');document.getElementById('form').classList.add('hidden');document.getElementById('open-app').classList.add('hidden');document.getElementById('title').classList.add('hidden');document.getElementById('description').classList.add('hidden');document.getElementById('success').classList.remove('hidden')}catch(e){error.textContent=e.message||'Unable to update password. Please request a new link.';error.classList.remove('hidden')}finally{button.disabled=false;button.textContent='Update Password'}
});
</script></body></html>`);
};

exports.normalizePhone = normalizePhone;
exports.validPassword = validPassword;
exports.sendResetLinkSms = sendResetLinkSms;
