const multer = require("multer");

const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_PROFILE_IMAGE_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype.toLowerCase())) {
      const error = new Error("Choose a JPG, JPEG, PNG, or WEBP image.");
      error.statusCode = 415;
      return callback(error);
    }
    return callback(null, true);
  },
});

module.exports = (req, res, next) => {
  upload.single("image")(req, res, (error) => {
    if (!error) return next();

    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        success: false,
        message: "Profile images must be 5 MB or smaller.",
      });
    }

    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Unable to receive the profile image.",
    });
  });
};
