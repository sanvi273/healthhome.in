
const User = require("../models/user");
const {
    getCurrentTerms,
    findAcceptanceToken,
    hasCurrentAcceptance,
    associateAcceptance,
} = require("../services/termsAcceptanceService");
const Verification = require("../models/verification");
const VerificationCounter = require("../models/verificationCounter");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const normalizePhoneForLookup = (input) => {
    const value = String(input || "").trim().replace(/[\s()-]/g, "");
    if (!/^\+?[1-9]\d{7,14}$/.test(value)) return null;

    const digits = value.replace(/\D/g, "");
    return /^[6-9]\d{9}$/.test(digits) ? `91${digits}` : digits;
};

const phoneLookupQuery = (normalizedPhone) => {
    const variants = new Set([normalizedPhone, `+${normalizedPhone}`]);
    if (/^91[6-9]\d{9}$/.test(normalizedPhone)) {
        variants.add(normalizedPhone.slice(2));
    }

    const formattedVariants = [...variants].map((variant) => {
        const digits = variant.replace(/\D/g, "");
        return new RegExp(`^\\+?${digits.split("").join("[\\s().-]*")}$`);
    });

    return { $in: [...variants, ...formattedVariants] };
};

// ============================================================
// GENERATE HEALTHHOME VERIFICATION ID
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

    const idPrefix = `HH-${prefix}-${year}-`;
    const pattern = `^${idPrefix}`;
    const latest = await Verification.findOne({
        verificationId: { $regex: pattern },
    }).sort({ verificationId: -1 }).select("verificationId").lean();
    const latestUser = await User.findOne({
        verificationId: { $regex: pattern },
    }).sort({ verificationId: -1 }).select("verificationId").lean();
    const existingSequence = Math.max(
        latest ? Number(latest.verificationId.slice(idPrefix.length)) || 0 : 0,
        latestUser ? Number(latestUser.verificationId.slice(idPrefix.length)) || 0 : 0
    );
    const sequenceKey = `${role}-${year}`;
    const counter = await VerificationCounter.findOneAndUpdate(
        { _id: sequenceKey },
        [{
            $set: {
                value: {
                    $add: [
                        { $max: [{ $ifNull: ["$value", 0] }, existingSequence] },
                        1,
                    ],
                },
            },
        }],
        {
            new: true,
            upsert: true,
            setDefaultsOnInsert: true,
            // Mongoose 9 requires this opt-in for aggregation-pipeline updates.
            updatePipeline: true,
        }
    );

    const nextNumber = String(counter.value).padStart(6, "0");

    return `${idPrefix}${nextNumber}`;
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
            label,
            fullAddress,
            landmark,
            city,
            state,
            pincode,
            latitude,
            longitude,
        } = req.body;

        // VALIDATE REQUIRED FIELDS
        if (!name || !email || !password || !role || !phone) {
            return res.status(400).json({
                success: false,
                message: "Name, email, password, role and phone are required",
            });
        }

        // NORMALIZE ROLE
        const normalizedRole = String(role).trim().toLowerCase();

        const allowedPublicRoles = [
            "patient",
            "doctor",
            "laboratory",
            "pharmacy",
        ];

        if (!allowedPublicRoles.includes(normalizedRole)) {
            return res.status(400).json({
                success: false,
                message: "Invalid role. Admin accounts cannot be created through public registration.",
            });
        }

        // ADDRESS VALIDATION
        if (!label || !fullAddress || !city || !state || !pincode) {
            return res.status(400).json({
                success: false,
                message: "Address is required. Please provide label, full address, city, state and pincode",
            });
        }

        // NORMALIZE EMAIL
        const normalizedEmail = String(email).trim().toLowerCase();

        // CHECK EMAIL
        const emailExists = await User.findOne({
            email: normalizedEmail,
        });

        if (emailExists) {
            return res.status(400).json({
                success: false,
                message: "Email already exists",
            });
        }

        // NORMALIZE AND CHECK PHONE
        const normalizedPhone = String(phone).trim();

        const phoneExists = await User.findOne({
            phone: normalizedPhone,
        });

        if (phoneExists) {
            return res.status(400).json({
                success: false,
                message: "Phone number already exists",
            });
        }

        // HASH PASSWORD
        const hashedPassword = await bcrypt.hash(password, 10);

        // ACCOUNT STATUS
        let accountStatus = "ACTIVE";
        let verificationStatus = "NOT_REQUIRED";
        let verificationId = "";

        // PROFESSIONAL VERIFICATION
        const isProfessional = [
            "doctor",
            "laboratory",
            "pharmacy",
        ].includes(normalizedRole);

        if (isProfessional) {
            accountStatus = "ACTIVE";
            verificationStatus = "PENDING";

            verificationId = await generateVerificationId(
                normalizedRole
            );
        }

        // CREATE USER
        const user = await User.create({
            name: String(name).trim(),
            email: normalizedEmail,
            password: hashedPassword,
            role: normalizedRole,
            phone: normalizedPhone,

            addresses: [
                {
                    label: String(label).trim(),
                    fullAddress: String(fullAddress).trim(),
                    landmark: landmark
                        ? String(landmark).trim()
                        : "",
                    city: String(city).trim(),
                    state: String(state).trim(),
                    pincode: String(pincode).trim(),

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

                    isDefault: true,
                },
            ],

            accountStatus,
            verificationStatus,
            verificationId,
        });

        // ====================================================
        // AUTOMATIC PROFESSIONAL VERIFICATION APPLICATION
        // ====================================================

        if (isProfessional) {
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
                    "VERIFICATION CREATED SUCCESSFULLY:",
                    user.verificationId,
                    normalizedRole
                );

            } catch (verificationError) {
                console.error(
                    "VERIFICATION CREATION ERROR:",
                    verificationError
                );

                // Avoid leaving a professional user without
                // a corresponding verification application.
                await User.findByIdAndDelete(user._id);

                throw verificationError;
            }
        }

        // RESPONSE MESSAGE
        let message = "User registered successfully";

        if (normalizedRole === "doctor") {
            message = "Doctor registration submitted successfully. Your account is pending verification.";
        }

        if (normalizedRole === "laboratory") {
            message = "Laboratory registration submitted successfully. Your account is pending verification.";
        }

        if (normalizedRole === "pharmacy") {
            message = "Pharmacy registration submitted successfully. Your account is pending verification.";
        }

        // SUCCESS RESPONSE
        return res.status(201).json({
            success: true,
            message: message,
            user: {
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                phone: user.phone,
                accountStatus: user.accountStatus,
                verificationStatus: user.verificationStatus,
                verificationId: user.verificationId,
            },
        });

    } catch (error) {
        console.error("REGISTER ERROR:", error);

        return res.status(500).json({
            success: false,
            message: error.message,
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
            role,
            termsAcceptanceToken,
        } = req.body;

        // VALIDATE
        if (!phone || !password) {
            return res.status(400).json({
                success: false,
                message: "Phone and password are required",
            });
        }

        // FIND USER BY PHONE
        const requestedRole = String(role || "").trim().toLowerCase();
        const normalizedRole = requestedRole === "lab" ? "laboratory" : requestedRole;
        if (!["patient", "doctor", "laboratory", "pharmacy", "admin"].includes(normalizedRole)) {
            return res.status(400).json({ success: false, message: "Please select a valid account role." });
        }

        const normalizedPhone = normalizePhoneForLookup(phone);
        if (!normalizedPhone) {
            return res.status(400).json({
                success: false,
                message: "Please enter a valid phone number.",
            });
        }

        const roleVariants = normalizedRole === "laboratory"
            ? ["laboratory", "lab"]
            : [normalizedRole];

        const user = await User.findOne({
            phone: phoneLookupQuery(normalizedPhone),
            role: { $in: roleVariants },
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        // CHECK PASSWORD
        const isMatch = await bcrypt.compare(
            password,
            user.password
        );

        if (!isMatch) {
            return res.status(400).json({
                success: false,
                message: "Invalid password",
            });
        }

        // CHECK ACCOUNT SUSPENSION
        if (user.accountStatus === "SUSPENDED") {
            return res.status(403).json({
                success: false,
                message: user.suspensionReason
                    ? `Your account has been suspended. Reason: ${user.suspensionReason}`
                    : "Your account has been suspended. Please contact HealthHome support.",
            });
        }

        if (normalizedRole !== "admin") {
            const currentTerms = getCurrentTerms(normalizedRole);
            if (!await hasCurrentAcceptance(user._id, normalizedRole, currentTerms)) {
                const acceptance = await findAcceptanceToken(
                    termsAcceptanceToken,
                    normalizedRole,
                    currentTerms,
                    user._id,
                );
                if (!acceptance || !await associateAcceptance(acceptance._id, user._id, normalizedRole, currentTerms)) {
                    return res.status(428).json({
                        success: false,
                        code: "TERMS_ACCEPTANCE_REQUIRED",
                        message: "Please review and accept the current terms for this role before signing in.",
                    });
                }
            }
        }

        // PROFESSIONAL STATUS
        const isProfessional =
            user.role === "doctor" ||
            user.role === "laboratory" ||
            user.role === "pharmacy";

        // CREATE JWT TOKEN
        const token = jwt.sign(
            {
                id: user._id,
                role: user.role,
                verificationStatus: user.verificationStatus,
            },
            process.env.JWT_SECRET,
            {
                expiresIn: "7d",
            }
        );

        // RESPONSE MESSAGE
        let message = "Login successful";

        if (
            isProfessional &&
            user.verificationStatus === "PENDING"
        ) {
            message = "Login successful. Your professional account is pending verification.";
        }

        if (
            isProfessional &&
            user.verificationStatus === "UNDER_REVIEW"
        ) {
            message = "Login successful. Your professional documents are currently under review.";
        }

        if (
            isProfessional &&
            user.verificationStatus === "REJECTED"
        ) {
            message = "Login successful. Your professional verification was rejected. Please review your verification details.";
        }

        // SUCCESS RESPONSE
        return res.status(200).json({
            success: true,
            message: message,
            token,
            user: {
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                phone: user.phone,
                profileImage: user.profileImage,
                accountStatus: user.accountStatus,
                verificationStatus: user.verificationStatus,
                verificationId: user.verificationId,
                addresses: user.addresses,
            },
        });

    } catch (error) {
        console.error("LOGIN ERROR:", error);

        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

// ============================================================
// UPDATE ONESIGNAL ID
// ============================================================

const updateOneSignalId = async (req, res) => {
    try {
        const {
            phone,
            oneSignalId,
        } = req.body;

        const user = await User.findOneAndUpdate(
            {
                phone: String(phone).trim(),
            },
            {
                oneSignalId: oneSignalId,
            },
            {
                new: true,
            }
        );

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        return res.status(200).json({
            success: true,
            message: "OneSignal ID Updated",
        });

    } catch (error) {
        console.error("ONESIGNAL UPDATE ERROR:", error);

        return res.status(500).json({
            success: false,
            message: error.message,
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
    generateVerificationId,
};
