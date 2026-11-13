const mongoose = require("mongoose");
const Medicine = require("../models/medicine");
const cloudinary = require("../config/cloudinary");
const uploadToCloudinary = require("../utils/cloudinaryUpload");

const imageMimeTypes = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/octet-stream",
]);

const validateMedicineImageFile = (file) => {
  if (!file) return;

  const extension = String(file.originalname || "")
    .split(".")
    .pop()
    .toLowerCase();
  if (!imageMimeTypes.has(String(file.mimetype || "").toLowerCase())) {
    const error = new Error("Choose a JPG, PNG, or WebP medicine photo.");
    error.statusCode = 400;
    throw error;
  }

  const bytes = file.buffer;
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    const error = new Error("The selected medicine photo is empty.");
    error.statusCode = 400;
    throw error;
  }

  const isJpeg = extension === "jpg" || extension === "jpeg";
  const hasJpegSignature =
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;
  const isPng = extension === "png";
  const hasPngSignature =
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = extension === "webp";
  const hasWebpSignature =
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP";

  if (
    !(isJpeg && hasJpegSignature) &&
    !(isPng && hasPngSignature) &&
    !(isWebp && hasWebpSignature)
  ) {
    const error = new Error("The photo contents do not match a JPG, PNG, or WebP file.");
    error.statusCode = 400;
    throw error;
  }
};

const validateImageUrl = (value) => {
  const image = String(value ?? "").trim();
  if (!image) return "";

  let parsed;
  try {
    parsed = new URL(image);
  } catch (_error) {
    const error = new Error("Medicine image must be a valid HTTPS Cloudinary URL.");
    error.statusCode = 400;
    throw error;
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.hostname.toLowerCase() !== "res.cloudinary.com" ||
    !parsed.pathname.split("/").filter(Boolean).length
  ) {
    const error = new Error("Medicine image must be a valid HTTPS Cloudinary URL.");
    error.statusCode = 400;
    throw error;
  }
  return parsed.toString();
};

const uploadMedicinePhoto = async (file) => {
  if (!file) return null;
  validateMedicineImageFile(file);

  const uploaded = await uploadToCloudinary(file, "medicine_images");
  const secureUrl = String(uploaded?.secure_url || "");
  if (!secureUrl.startsWith("https://")) {
    if (uploaded?.public_id) {
      await cloudinary.uploader.destroy(uploaded.public_id).catch(() => {});
    }
    throw new Error("Image storage did not return a secure HTTPS URL.");
  }
  return uploaded;
};

const removeUnusedCloudinaryImage = async (uploaded) => {
  if (!uploaded?.public_id) return;
  try {
    await cloudinary.uploader.destroy(uploaded.public_id, {
      resource_type: uploaded.resource_type || "image",
    });
  } catch (error) {
    console.error("UNUSED MEDICINE IMAGE CLEANUP ERROR:", error.message);
  }
};

const validateMedicineFields = (body, { partial = false } = {}) => {
  const medicineName = String(body.medicineName ?? "").trim();
  const price = Number(body.price);
  const stock = Number(body.stock);

  if ((!partial || body.medicineName !== undefined) && !medicineName) {
    const error = new Error("Medicine name is required.");
    error.statusCode = 400;
    throw error;
  }
  if ((!partial || body.price !== undefined) && (!Number.isFinite(price) || price < 0)) {
    const error = new Error("Enter a valid medicine price.");
    error.statusCode = 400;
    throw error;
  }
  if ((!partial || body.stock !== undefined) && (!Number.isInteger(stock) || stock < 0)) {
    const error = new Error("Enter a valid whole number for medicine stock.");
    error.statusCode = 400;
    throw error;
  }
};

const validateSubmissionKey = (value) => {
  const key = String(value ?? "").trim();
  if (key && !/^[A-Za-z0-9_-]{16,128}$/.test(key)) {
    const error = new Error("Medicine submission key is invalid.");
    error.statusCode = 400;
    throw error;
  }
  return key;
};

const findSubmission = (pharmacyPhone, submissionKey) =>
  Medicine.findOne({ pharmacyPhone, submissionKey });

const medicineResponseValue = (medicine) => {
  const value = typeof medicine?.toObject === "function"
    ? medicine.toObject()
    : { ...medicine };
  delete value.submissionKey;
  return value;
};

const addMedicine = async (req, res) => {
  let uploadedImage = null;
  let submissionKey = "";
  try {
    validateMedicineFields(req.body);
    submissionKey = validateSubmissionKey(req.body.submissionKey);
    if (submissionKey) {
      const existing = await findSubmission(req.pharmacy.phone, submissionKey);
      if (existing) {
        return res.status(200).json({
          success: true,
          message: "Medicine was already added successfully.",
          medicine: medicineResponseValue(existing),
        });
      }
    }
    if (!req.file && String(req.body.image ?? "").trim()) {
      const error = new Error("Medicine photos must be uploaded with the medicine form.");
      error.statusCode = 400;
      throw error;
    }

    uploadedImage = await uploadMedicinePhoto(req.file);
    const image = uploadedImage ? uploadedImage.secure_url : "";

    const medicine = await Medicine.create({
      // The owner is resolved from the verified JWT, never from the request body.
      pharmacyPhone: req.pharmacy.phone,
      medicineName: String(req.body.medicineName).trim(),
      category: String(req.body.category || "Tablet").trim(),
      manufacturer: String(req.body.manufacturer || "").trim(),
      description: String(req.body.description || "").trim(),
      price: Number(req.body.price),
      stock: Number(req.body.stock),
      image,
      status: "Available",
      ...(submissionKey ? { submissionKey } : {}),
    });

    return res.status(201).json({
      success: true,
      message: "Medicine added successfully",
      medicine: medicineResponseValue(medicine),
    });
  } catch (error) {
    if (uploadedImage) await removeUnusedCloudinaryImage(uploadedImage);
    if (error.code === 11000 && submissionKey) {
      try {
        const existing = await findSubmission(req.pharmacy.phone, submissionKey);
        if (existing) {
          return res.status(200).json({
            success: true,
            message: "Medicine was already added successfully.",
            medicine: medicineResponseValue(existing),
          });
        }
      } catch (lookupError) {
        console.error("MEDICINE RETRY LOOKUP ERROR:", lookupError.message);
      }
    }
    console.error("ADD MEDICINE ERROR:", error.message);
    return res.status(error.statusCode || (error.name === "ValidationError" ? 400 : 500)).json({
      success: false,
      message: error.statusCode || error.name === "ValidationError"
        ? error.message
        : "Unable to add medicine. Please try again.",
    });
  }
};

const getMedicines = async (_req, res) => {
  try {
    const medicines = await Medicine.find();
    return res.status(200).json({ success: true, medicines });
  } catch (error) {
    console.error("GET MEDICINES ERROR:", error.message);
    return res.status(500).json({ success: false, message: "Unable to load medicines." });
  }
};

const getInventoryStats = async (_req, res) => {
  try {
    const medicines = await Medicine.find();
    return res.status(200).json({
      success: true,
      total: medicines.length,
      lowStock: medicines.filter((medicine) => medicine.stock < 10).length,
      outOfStock: medicines.filter((medicine) => medicine.stock <= 0).length,
      available: medicines.filter((medicine) => medicine.status === "Available").length,
    });
  } catch (error) {
    console.error("INVENTORY STATS ERROR:", error.message);
    return res.status(500).json({ success: false, message: "Unable to load inventory stats." });
  }
};

const deleteMedicine = async (req, res) => {
  try {
    const medicineId = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(medicineId)) {
      return res.status(400).json({ success: false, message: "Invalid medicine ID." });
    }

    const medicine = await Medicine.findById(medicineId);
    if (!medicine) {
      return res.status(404).json({ success: false, message: "Medicine not found." });
    }
    if (medicine.pharmacyPhone !== req.pharmacy.phone) {
      return res.status(403).json({ success: false, message: "You cannot modify another pharmacy's medicine." });
    }

    await Medicine.findByIdAndDelete(medicineId);
    // Cloudinary assets are intentionally retained. A URL may be shared by
    // another inventory record, so deletion cannot safely infer ownership.
    return res.status(200).json({ success: true, message: "Medicine deleted successfully." });
  } catch (error) {
    console.error("DELETE MEDICINE ERROR:", error.message);
    return res.status(500).json({ success: false, message: "Unable to delete medicine." });
  }
};

const updateMedicine = async (req, res) => {
  let uploadedImage = null;
  try {
    const medicineId = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(medicineId)) {
      return res.status(400).json({ success: false, message: "Invalid medicine ID." });
    }

    const medicine = await Medicine.findById(medicineId);
    if (!medicine) {
      return res.status(404).json({ success: false, message: "Medicine not found." });
    }
    if (medicine.pharmacyPhone !== req.pharmacy.phone) {
      return res.status(403).json({ success: false, message: "You cannot modify another pharmacy's medicine." });
    }

    validateMedicineFields(req.body, { partial: true });
    if (!req.file && Object.prototype.hasOwnProperty.call(req.body, "image")) {
      const requestedImage = validateImageUrl(req.body.image);
      const existingImage = String(medicine.image || "");
      if (requestedImage && requestedImage !== existingImage) {
        const error = new Error("Select and upload a replacement medicine photo before updating it.");
        error.statusCode = 400;
        throw error;
      }
    }

    uploadedImage = await uploadMedicinePhoto(req.file);
    const changes = {};
    for (const field of ["medicineName", "category", "manufacturer", "description", "price", "stock"]) {
      if (req.body[field] !== undefined) {
        changes[field] = ["price", "stock"].includes(field)
          ? Number(req.body[field])
          : String(req.body[field]).trim();
      }
    }
    if (uploadedImage) {
      changes.image = uploadedImage.secure_url;
    } else if (Object.prototype.hasOwnProperty.call(req.body, "image")) {
      changes.image = validateImageUrl(req.body.image);
    }

    const updatedMedicine = await Medicine.findByIdAndUpdate(
      medicineId,
      { $set: changes },
      { new: true, runValidators: true },
    );

    if (!updatedMedicine) {
      if (uploadedImage) await removeUnusedCloudinaryImage(uploadedImage);
      return res.status(404).json({ success: false, message: "Medicine not found." });
    }
    return res.status(200).json({
      success: true,
      message: "Medicine updated successfully",
      medicine: updatedMedicine,
    });
  } catch (error) {
    if (uploadedImage) await removeUnusedCloudinaryImage(uploadedImage);
    console.error("UPDATE MEDICINE ERROR:", error.message);
    return res.status(error.statusCode || (error.name === "ValidationError" ? 400 : 500)).json({
      success: false,
      message: error.statusCode || error.name === "ValidationError"
        ? error.message
        : "Unable to update medicine. Please try again.",
    });
  }
};

module.exports = {
  addMedicine,
  getMedicines,
  deleteMedicine,
  updateMedicine,
  getInventoryStats,
  validateMedicineImageFile,
  validateImageUrl,
  validateSubmissionKey,
};
