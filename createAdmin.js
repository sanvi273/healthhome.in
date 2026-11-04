
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const User = require("./models/user");

async function createAdmin() {
  try {
    // Support common MongoDB environment variable names
    const mongoUri =
      process.env.MONGO_URI ||
      process.env.MONGODB_URI ||
      process.env.MONGO_URL;

    const phone = process.env.ADMIN_PHONE;
    const password = process.env.ADMIN_PASSWORD;
    const email = process.env.ADMIN_EMAIL;

    // Validate environment variables
    if (!mongoUri) {
      throw new Error(
        "MongoDB URL missing. Add MONGO_URI or MONGODB_URI to your .env file."
      );
    }

    if (!phone || !password) {
      throw new Error(
        "ADMIN_PHONE and ADMIN_PASSWORD are required in .env"
      );
    }

    if (password.length < 8) {
      throw new Error("Admin password must contain at least 8 characters.");
    }

    // Connect to MongoDB
    await mongoose.connect(mongoUri);

    console.log("MongoDB connected successfully.");

    // Check whether this phone number already exists
    const existing = await User.findOne({ phone });

    const hashedPassword = await bcrypt.hash(password, 10);

    if (existing) {
      // Never accidentally promote an existing professional/patient
      if (existing.role !== "admin") {
        throw new Error(
          "This phone number already belongs to a non-admin account. Use a different phone number."
        );
      }

      existing.name = "HealthHome Admin";
      existing.password = hashedPassword;
      existing.accountStatus = "ACTIVE";
      existing.verificationStatus = "NOT_REQUIRED";

      if (email) {
        existing.email = email;
      }

      await existing.save();

      console.log("Existing Admin account updated successfully.");
    } else {
      // Create new Admin
      await User.create({
        name: "HealthHome Admin",
        email: email || undefined,
        phone: phone,
        password: hashedPassword,
        role: "admin",
        accountStatus: "ACTIVE",
        verificationStatus: "NOT_REQUIRED",
      });

      console.log("Admin account created successfully!");
    }

    console.log("Admin phone:", phone);
    console.log("Admin role: admin");
  } catch (error) {
    console.error("Admin creation failed:", error.message);
  } finally {
    // Disconnect only if MongoDB was connected
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
}

createAdmin();
