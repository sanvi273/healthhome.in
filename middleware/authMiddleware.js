const jwt = require("jsonwebtoken");
const User = require("../models/user");

const authMiddleware = async (req, res, next) => {
  try {
    // Get Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "Authorization token is required",
      });
    }

    // Expected format:
    // Authorization: Bearer YOUR_TOKEN
    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Invalid authorization format",
      });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Token is missing",
      });
    }

    // Verify JWT
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    const user = await User.findById(decoded.id).select("passwordChangedAt accountStatus").lean();
    if (!user || user.accountStatus === "SUSPENDED" ||
      (user.passwordChangedAt && decoded.iat * 1000 < user.passwordChangedAt.getTime())) {
      return res.status(401).json({ success: false, message: "Session is no longer valid. Please sign in again." });
    }

    // Store authenticated user information
    req.user = {
      id: decoded.id,
      role: decoded.role,
      verificationStatus: decoded.verificationStatus,
    };

    next();
  } catch (error) {
    console.error("AUTH MIDDLEWARE ERROR:", error.message);

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Token has expired. Please login again",
      });
    }

    return res.status(401).json({
      success: false,
      message: "Invalid or unauthorized token",
    });
  }
};

module.exports = authMiddleware;
