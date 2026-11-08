const multer = require("multer");
const path = require("path");

const mimeByExtension = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    const expectedMime = mimeByExtension[extension];
    const mimeIsGeneric = file.mimetype === "application/octet-stream";

    if (
      !expectedMime ||
      (!mimeIsGeneric && file.mimetype !== expectedMime)
    ) {
      const error = new Error("Upload a PDF, JPG, JPEG, or PNG document");
      error.code = "UNSUPPORTED_FILE_TYPE";
      return callback(error);
    }

    return callback(null, true);
  },
});

module.exports = (req, res, next) => {
  upload.single("document")(req, res, (error) => {
    if (!error) return next();

    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        success: false,
        message: "Document must be 10 MB or smaller",
      });
    }

    if (error.code === "UNSUPPORTED_FILE_TYPE") {
      return res.status(415).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(400).json({
      success: false,
      message: "Unable to read the uploaded document",
    });
  });
};
