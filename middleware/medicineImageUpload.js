const multer = require("multer");

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  // Some web browsers report octet-stream for files selected from disk. The
  // controller also checks the extension and file signature before upload.
  "application/octet-stream",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype.toLowerCase())) {
      const error = new Error("Choose a JPG, PNG, or WebP medicine photo.");
      error.code = "INVALID_MEDICINE_IMAGE_TYPE";
      return callback(error);
    }
    return callback(null, true);
  },
});

const uploadMedicineImage = (req, res, next) => {
  upload.single("image")(req, res, (error) => {
    if (!error) return next();

    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        success: false,
        message: "Medicine photos must be 5 MB or smaller.",
      });
    }

    return res.status(400).json({
      success: false,
      message: error.message || "The medicine photo could not be accepted.",
    });
  });
};

module.exports = uploadMedicineImage;
