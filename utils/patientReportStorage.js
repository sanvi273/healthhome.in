const uploadToCloudinary = require("./cloudinaryUpload");
const cloudinary = require("../config/cloudinary");

const detectPatientReportFormat = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;

  if (
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return { fileType: "image/jpeg", format: "jpg" };
  }

  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return { fileType: "image/png", format: "png" };
  }

  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { fileType: "image/webp", format: "webp" };
  }

  if (buffer.toString("ascii", 0, 5) === "%PDF-") {
    return { fileType: "application/pdf", format: "pdf" };
  }

  return null;
};

const uploadPatientReport = async (file) => {
  const detected = detectPatientReportFormat(file?.buffer);
  if (!detected) {
    const error = new Error("Report must be a valid JPG, PNG, WebP or PDF file.");
    error.statusCode = 400;
    throw error;
  }

  const uploaded = await uploadToCloudinary(
    file,
    "appointment_reports",
    { type: "authenticated" },
  );
  const storagePublicId = String(uploaded?.public_id || "").trim();
  const resourceType = String(uploaded?.resource_type || "").trim();
  const fileFormat = String(uploaded?.format || detected.format).trim();

  if (!storagePublicId || !resourceType || !fileFormat) {
    throw new Error("Cloud storage did not return a complete report reference.");
  }

  return {
    fileName: file.originalname || "Patient Report",
    fileType: detected.fileType,
    storagePublicId,
    resourceType,
    fileFormat,
    uploadedAt: new Date(),
  };
};

const isAllowedLegacyCloudinaryUrl = (value) => {
  try {
    const uri = new URL(String(value || ""));
    const cloudName = String(process.env.CLOUDINARY_CLOUD_NAME || "").trim();
    return uri.protocol === "https:" &&
      uri.hostname === "res.cloudinary.com" &&
      cloudName.length > 0 &&
      uri.pathname.startsWith(`/${cloudName}/`);
  } catch (_) {
    return false;
  }
};

const getPatientReportBytes = async (report) => {
  let deliveryUrl = "";
  if (report?.storagePublicId && report?.resourceType && report?.fileFormat) {
    deliveryUrl = cloudinary.utils.private_download_url(
      report.storagePublicId,
      report.fileFormat,
      {
        resource_type: report.resourceType,
        type: "authenticated",
        expires_at: Math.floor(Date.now() / 1000) + 60,
        attachment: false,
      },
    );
  } else if (isAllowedLegacyCloudinaryUrl(report?.fileUrl)) {
    // Legacy uploads used Cloudinary's public delivery type. Fetch them through
    // this authenticated, ownership-checked endpoint instead of returning the
    // public storage URL to the Flutter client.
    deliveryUrl = report.fileUrl;
  } else {
    const error = new Error("Stored report file reference is unavailable.");
    error.statusCode = 404;
    throw error;
  }

  const response = await fetch(deliveryUrl, { redirect: "error" });
  if (!response.ok) {
    const error = new Error("Stored report file could not be retrieved.");
    error.statusCode = response.status === 404 ? 404 : 502;
    throw error;
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const detected = detectPatientReportFormat(bytes);
  if (!detected) {
    const error = new Error("Stored report is not a supported image or PDF.");
    error.statusCode = 415;
    throw error;
  }

  return { bytes, fileType: detected.fileType };
};

module.exports = {
  detectPatientReportFormat,
  uploadPatientReport,
  getPatientReportBytes,
  isAllowedLegacyCloudinaryUrl,
};
