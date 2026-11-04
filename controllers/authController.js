const User = require("../models/user");
const Verification = require("../models/verification");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
// ============================================================
// GENERATE HEALTHHOME VERIFICATION ID
// ============================================================
//
// Examples:
//
// HH-DOC-2026-000001
// HH-LAB-2026-000002
// HH-PHA-2026-000003
//
// This is HealthHome's internal verification ID.
// It is NOT the professional license number.
// ============================================================

const generateVerificationId = async (role) => {
    let prefix = "USR";

    if (role === "doctor") {
        prefix = "DOC";
    } else if (role === "laboratory") {
        prefix = "LAB";
    } else if (role === "pharmacy") {
        prefix = "PHA";
    }

    const year = new Date().getFullYear();

    // IMPORTANT:
    // Use "role" here because normalizedRole does not exist
    // inside this function.
    const count = await User.countDocuments({
        role: role,
        verificationId: {
            $regex: `^HH-${prefix}-${year}-`,
        },
    });

    const nextNumber = String(count + 1).padStart(6, "0");

    return `HH-${prefix}-${year}-${nextNumber}`;
};


// ============================================================
// REGISTER USER
// ============================================================

const registerUser = async (req, res) => {
    try {

        const {
            name,
            email,
            password,
            role,
            phone,

            // ADDRESS
            label,
            fullAddress,
            landmark,
            city,
            state,
            pincode,
            latitude,
            longitude,
        } = req.body;


        // ====================================================
        // VALIDATE REQUIRED FIELDS
        // ====================================================

        if (
            !name ||
            !email ||
            !password ||
            !role ||
            !phone
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Name, email, password, role and phone are required",
            });
        }


        // ====================================================
        // NORMALIZE ROLE
        // ====================================================

        const normalizedRole =
            String(role)
                .trim()
                .toLowerCase();


        // ====================================================
        // PUBLIC REGISTRATION ROLES
        // ====================================================
        //
        // IMPORTANT:
        // Admin cannot be created through public registration.
        //
        // Allowed:
        // patient
        // doctor
        // laboratory
        // pharmacy
        //
        // Admin will be created separately and securely.
        // ====================================================

        const allowedPublicRoles = [
            "patient",
            "doctor",
            "laboratory",
            "pharmacy",
        ];


        if (
            !allowedPublicRoles.includes(
                normalizedRole
            )
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Invalid role. Admin accounts cannot be created through public registration.",
            });
        }


        // ====================================================
        // ADDRESS IS REQUIRED
        // ====================================================

        if (
            !label ||
            !fullAddress ||
            !city ||
            !state ||
            !pincode
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Address is required. Please provide label, full address, city, state and pincode",
            });
        }


        // ====================================================
        // NORMALIZE EMAIL
        // ====================================================

        const normalizedEmail =
            String(email)
                .trim()
                .toLowerCase();


        // ====================================================
        // CHECK EMAIL EXISTS
        // ====================================================

        const emailExists =
            await User.findOne({
                email: normalizedEmail,
            });


        if (emailExists) {
            return res.status(400).json({
                success: false,
                message:
                    "Email already exists",
            });
        }


        // ====================================================
        // NORMALIZE PHONE
        // ====================================================

        const normalizedPhone =
            String(phone).trim();


        // ====================================================
        // CHECK PHONE EXISTS
        // ====================================================

        const phoneExists =
            await User.findOne({
                phone: normalizedPhone,
            });


        if (phoneExists) {
            return res.status(400).json({
                success: false,
                message:
                    "Phone number already exists",
            });
        }


        // ====================================================
        // HASH PASSWORD
        // ====================================================

        const hashedPassword =
            await bcrypt.hash(
                password,
                10
            );


        // ====================================================
        // DETERMINE ACCOUNT STATUS
        // ====================================================
        //
        // PATIENT
        // -------
        // Can use the application immediately.
        //
        // DOCTOR / LABORATORY / PHARMACY
        // -------------------------------
        // Registration is allowed, but professional
        // APIs/dashboard will remain blocked until
        // verification is APPROVED.
        // ====================================================

        let accountStatus = "ACTIVE";

        let verificationStatus =
            "NOT_REQUIRED";

        let verificationId = "";


        // ====================================================
        // PROFESSIONAL VERIFICATION
        // ====================================================

        if (
            normalizedRole === "doctor" ||
            normalizedRole === "laboratory" ||
            normalizedRole === "pharmacy"
        ) {

            accountStatus = "ACTIVE";

            verificationStatus =
                "PENDING";

            verificationId =
                await generateVerificationId(
                    normalizedRole
                );
        }


        // ====================================================
        // CREATE USER
        // ====================================================

        const user =
            await User.create({

                name:
                    String(name).trim(),

                email:
                    normalizedEmail,

                password:
                    hashedPassword,

                role:
                    normalizedRole,

                phone:
                    normalizedPhone,


                // ==================================================
                // FIRST ADDRESS
                // ==================================================

                addresses: [
                    {
                        label:
                            String(label).trim(),

                        fullAddress:
                            String(fullAddress).trim(),

                        landmark:
                            landmark
                                ? String(landmark).trim()
                                : "",

                        city:
                            String(city).trim(),

                        state:
                            String(state).trim(),

                        pincode:
                            String(pincode).trim(),

                        latitude:
                            latitude !== undefined &&
                            latitude !== null &&
                            latitude !== ""
                                ? Number(latitude)
                                : null,

                        longitude:
                            longitude !== undefined &&
                            longitude !== null &&
                            longitude !== ""
                                ? Number(longitude)
                                : null,

                        isDefault:
                            true,
                    },
                ],


                // ==================================================
                // VERIFICATION
                // ==================================================

                accountStatus:
                    accountStatus,

                verificationStatus:
                    verificationStatus,

                verificationId:
                    verificationId,
            });


// ====================================================
// AUTOMATIC PROFESSIONAL VERIFICATION APPLICATION
// ====================================================

if (
  ["doctor", "laboratory", "pharmacy"].includes(normalizedRole)
) {
  try {
    await Verification.create({
      userId: user._id,
      verificationId: user.verificationId,
      role: normalizedRole,
      professionalName: user.name,
      licenseNumber: "",
      organizationName: "",
      address: "",
      documents: [],
      notes: "",
      status: "PENDING",
    });

    console.log(
      `Verification created for ${user.name} (${normalizedRole})`
    );
  } catch (verificationError) {
    await User.findByIdAndDelete(user._id);
    throw verificationError;
  }
}

        // ====================================================
        // RESPONSE MESSAGE
        // ====================================================

        let message =
            "User registered successfully";


        if (
            normalizedRole === "doctor"
        ) {
            message =
                "Doctor registration submitted successfully. Your account is pending verification.";
        }


        if (
            normalizedRole === "laboratory"
        ) {
            message =
                "Laboratory registration submitted successfully. Your account is pending verification.";
        }


        if (
            normalizedRole === "pharmacy"
        ) {
            message =
                "Pharmacy registration submitted successfully. Your account is pending verification.";
        }


        // ====================================================
        // RESPONSE
        // ====================================================

        return res.status(201).json({

            success: true,

            message:
                message,

            user: {
                _id:
                    user._id,

                name:
                    user.name,

                email:
                    user.email,

                role:
                    user.role,

                phone:
                    user.phone,

                accountStatus:
                    user.accountStatus,

                verificationStatus:
                    user.verificationStatus,

                verificationId:
                    user.verificationId,
            },
        });


    } catch (error) {

        console.error(
            "REGISTER ERROR:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                error.message,
        });
    }
};


// ============================================================
// LOGIN USER
// ============================================================

const loginUser = async (req, res) => {
    try {

        const {
            phone,
            password,
        } = req.body;


        // ====================================================
        // VALIDATE
        // ====================================================

        if (
            !phone ||
            !password
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Phone and password are required",
            });
        }


        // ====================================================
        // FIND USER BY PHONE
        // ====================================================

        const user =
            await User.findOne({
                phone:
                    String(phone).trim(),
            });


        if (!user) {
            return res.status(404).json({
                success: false,
                message:
                    "User not found",
            });
        }


        // ====================================================
        // CHECK PASSWORD
        // ====================================================

        const isMatch =
            await bcrypt.compare(
                password,
                user.password
            );


        if (!isMatch) {
            return res.status(400).json({
                success: false,
                message:
                    "Invalid password",
            });
        }


        // ====================================================
        // CHECK ACCOUNT SUSPENSION
        // ====================================================

        if (
            user.accountStatus ===
            "SUSPENDED"
        ) {
            return res.status(403).json({
                success: false,
                message:
                    user.suspensionReason
                        ? `Your account has been suspended. Reason: ${user.suspensionReason}`
                        : "Your account has been suspended. Please contact HealthHome support.",
            });
        }


        // ====================================================
        // PROFESSIONAL VERIFICATION STATUS
        // ====================================================
        //
        // We allow the professional to login so they can
        // see their verification status.
        //
        // verificationMiddleware will prevent access to
        // professional APIs until APPROVED.
        // ====================================================

        const isProfessional =
            user.role === "doctor" ||
            user.role === "laboratory" ||
            user.role === "pharmacy";


        // ====================================================
        // CREATE JWT TOKEN
        // ====================================================

        const token =
            jwt.sign(

                {
                    id:
                        user._id,

                    role:
                        user.role,

                    verificationStatus:
                        user.verificationStatus,
                },

                process.env.JWT_SECRET,

                {
                    expiresIn:
                        "7d",
                }
            );


        // ====================================================
        // RESPONSE MESSAGE
        // ====================================================

        let message =
            "Login successful";


        if (
            isProfessional &&
            user.verificationStatus ===
                "PENDING"
        ) {
            message =
                "Login successful. Your professional account is pending verification.";
        }


        if (
            isProfessional &&
            user.verificationStatus ===
                "UNDER_REVIEW"
        ) {
            message =
                "Login successful. Your professional documents are currently under review.";
        }


        if (
            isProfessional &&
            user.verificationStatus ===
                "REJECTED"
        ) {
            message =
                "Login successful. Your professional verification was rejected. Please review your verification details.";
        }


        // ====================================================
        // RESPONSE
        // ====================================================

        return res.status(200).json({

            success: true,

            message:
                message,

            token,

            user: {

                _id:
                    user._id,

                name:
                    user.name,

                email:
                    user.email,

                role:
                    user.role,

                phone:
                    user.phone,

                profileImage:
                    user.profileImage,

                accountStatus:
                    user.accountStatus,

                verificationStatus:
                    user.verificationStatus,

                verificationId:
                    user.verificationId,

                addresses:
                    user.addresses,
            },
        });


    } catch (error) {

        console.error(
            "LOGIN ERROR:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                error.message,
        });
    }
};


// ============================================================
// UPDATE ONESIGNAL ID
// ============================================================

const updateOneSignalId = async (
    req,
    res
) => {
    try {

        const {
            phone,
            oneSignalId,
        } = req.body;


        const user =
            await User.findOneAndUpdate(

                {
                    phone:
                        String(phone).trim(),
                },

                {
                    oneSignalId:
                        oneSignalId,
                },

                {
                    new: true,
                }
            );


        if (!user) {
            return res.status(404).json({
                success: false,
                message:
                    "User not found",
            });
        }


        return res.status(200).json({
            success: true,
            message:
                "OneSignal ID Updated",
        });


    } catch (error) {

        console.error(
            "ONESIGNAL UPDATE ERROR:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                error.message,
        });
    }
};


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

    registerUser,

    loginUser,

    updateOneSignalId,

};