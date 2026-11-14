const Profile = require("../models/Profile");
const User = require("../models/user");
const Doctor = require("../models/doctor");
const Lab = require("../models/lab");
const Pharmacy = require("../models/pharmacy");
const cloudinary = require("../config/cloudinary");
const uploadToCloudinary = require("../utils/cloudinaryUpload");
const detectProfileImageMimeType = require("../utils/profileImageValidation");

const profileModels = {
  doctor: Doctor,
  laboratory: Lab,
  pharmacy: Pharmacy,
};

const profileFolders = {
  patient: "healthhome/patients/profiles",
  doctor: "healthhome/doctors/profiles",
  laboratory: "healthhome/laboratories/profiles",
  pharmacy: "healthhome/pharmacies/profiles",
};

const safeDeleteCloudinaryImage = async (publicId) => {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: "image",
      invalidate: true,
    });
  } catch (error) {
    console.warn("Unable to remove a replaced profile image", {
      errorType: error.name || "StorageError",
    });
  }
};

const findOwnedProfessionalProfile = async (user) => {
  const Model = profileModels[user.role];
  if (!Model || !user.phone) return null;

  return Model.findOne({
    $or: [
      { userId: user._id },
      {
        phone: user.phone,
        $or: [
          { userId: null },
          { userId: { $exists: false } },
        ],
      },
    ],
  });
};

const buildCurrentProfile = async (user) => {
  let profile = null;
  if (user.role === "patient" && user.phone) {
    profile = await Profile.findOne({ userId: user.phone }).lean();
  } else {
    const professionalProfile = await findOwnedProfessionalProfile(user);
    profile = professionalProfile?.toObject?.() || professionalProfile || null;
  }

  const legacyImage =
    profile?.profileImageUrl || profile?.photo || profile?.image || "";
  const profileImageUrl = user.profileImage || legacyImage;
  const serialized = {
    ...(profile || {}),
    _id: profile?._id,
    name: profile?.name || user.name,
    role: user.role,
    profileImageUrl,
    profileImagePublicId:
      user.profileImagePublicId || profile?.profileImagePublicId || "",
  };

  if (user.role === "patient") {
    serialized.photo = profileImageUrl;
  }

  return serialized;
};

exports.getMyProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user?.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User account not found.",
      });
    }

    return res.status(200).json({
      success: true,
      profile: await buildCurrentProfile(user),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Unable to load your profile.",
    });
  }
};

exports.uploadMyProfileImage = async (req, res) => {
  let uploadedImage = null;
  let savedToUser = false;
  try {
    const user = await User.findById(req.user?.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User account not found.",
      });
    }

    if (!Object.prototype.hasOwnProperty.call(profileFolders, user.role)) {
      return res.status(403).json({
        success: false,
        message: "This account cannot upload a profile image.",
      });
    }

    if (!req.file?.buffer?.length) {
      return res.status(400).json({
        success: false,
        message: "Choose a profile image to upload.",
      });
    }

    const detectedMimeType = detectProfileImageMimeType(req.file.buffer);
    if (!detectedMimeType || detectedMimeType !== req.file.mimetype) {
      return res.status(415).json({
        success: false,
        message: "The selected file is not a valid JPG, PNG, or WEBP image.",
      });
    }

    const cloudinaryConfig = cloudinary.config();
    if (
      !cloudinaryConfig.cloud_name ||
      !cloudinaryConfig.api_key ||
      !cloudinaryConfig.api_secret
    ) {
      return res.status(503).json({
        success: false,
        message: "Profile image storage is not configured on the server.",
      });
    }

    uploadedImage = await uploadToCloudinary(
      req.file,
      profileFolders[user.role],
      {
        resource_type: "image",
        allowed_formats: ["jpg", "jpeg", "png", "webp"],
      },
    );

    if (!uploadedImage?.secure_url || !uploadedImage?.public_id) {
      throw new Error("The image storage provider returned an invalid result.");
    }

    const previousPublicId = user.profileImagePublicId;
    user.profileImage = uploadedImage.secure_url;
    user.profileImagePublicId = uploadedImage.public_id;
    await user.save();
    savedToUser = true;

    // Keep the role-specific MongoDB profile references aligned when those
    // profiles already exist. User remains the canonical owner/reference.
    let profileSyncSucceeded = true;
    let replacedProfilePublicId = "";
    try {
      if (user.role === "patient") {
        if (user.phone) {
          const previousProfile = await Profile.findOne({
            userId: user.phone,
          }).select("profileImagePublicId").lean();
          replacedProfilePublicId =
            previousProfile?.profileImagePublicId || "";
          await Profile.findOneAndUpdate(
            { userId: user.phone },
            {
              $set: {
                userId: user.phone,
                photo: uploadedImage.secure_url,
                profileImageUrl: uploadedImage.secure_url,
                profileImagePublicId: uploadedImage.public_id,
              },
            },
            { new: true, upsert: true, setDefaultsOnInsert: true },
          );
        }
      } else {
        const professionalProfile = await findOwnedProfessionalProfile(user);
        if (professionalProfile) {
          replacedProfilePublicId =
            professionalProfile.profileImagePublicId || "";
          professionalProfile.userId = user._id;
          professionalProfile.profileImageUrl = uploadedImage.secure_url;
          professionalProfile.profileImagePublicId = uploadedImage.public_id;
          if (user.role === "laboratory" || user.role === "pharmacy") {
            professionalProfile.image = uploadedImage.secure_url;
          }
          await professionalProfile.save();
        }
      }
    } catch (profileSyncError) {
      profileSyncSucceeded = false;
      console.error("PROFILE IMAGE MIRROR UPDATE FAILED", {
        role: user.role,
        errorType: profileSyncError.name || "DatabaseError",
      });
    }

    if (profileSyncSucceeded) {
      if (previousPublicId && previousPublicId !== uploadedImage.public_id) {
        await safeDeleteCloudinaryImage(previousPublicId);
      }
      if (
        replacedProfilePublicId &&
        replacedProfilePublicId !== previousPublicId &&
        replacedProfilePublicId !== uploadedImage.public_id
      ) {
        await safeDeleteCloudinaryImage(replacedProfilePublicId);
      }
    }

    const profile = await buildCurrentProfile(user);
    return res.status(200).json({
      success: true,
      message: "Profile photo updated successfully.",
      profile,
      profileImageUrl: uploadedImage.secure_url,
    });
  } catch (error) {
    if (uploadedImage?.public_id && !savedToUser) {
      await safeDeleteCloudinaryImage(uploadedImage.public_id);
    }
    console.error("PROFILE IMAGE UPLOAD FAILED", {
      errorType: error.name || "StorageError",
    });
    if (savedToUser && uploadedImage?.secure_url) {
      return res.status(200).json({
        success: true,
        message: "Profile photo updated successfully.",
        profileImageUrl: uploadedImage.secure_url,
        profile: {
          role: req.user.role,
          profileImageUrl: uploadedImage.secure_url,
        },
      });
    }
    return res.status(500).json({
      success: false,
      message: "Unable to save your profile photo. Please try again.",
    });
  }
};

// SAVE OR UPDATE PROFILE
exports.saveProfile = async (req, res) => {
  try {
    const {
      userId,
      name,
      age,
      gender,
      bloodGroup,
      height,
      weight,
      photo,
    } = req.body;

    const profile = await Profile.findOneAndUpdate(
      { userId },
      {
        userId,
        name,
        age,
        gender,
        bloodGroup,
        height,
        weight,
        photo,
      },
      {
        new: true,
        upsert: true,
      }
    );

    res.json({
      success: true,
      profile,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// GET PROFILE
exports.getProfile = async (req, res) => {
  try {
    const profile = await Profile.findOne({
      userId: req.params.userId,
    });

    if (!profile) {
      return res.json({
        success: false,
        message: "Profile not found",
      });
    }

    const user = await User.findOne({
      phone: req.params.userId,
      role: "patient",
    }).select("profileImage profileImagePublicId").lean();
    const imageUrl = user?.profileImage || profile.profileImageUrl || profile.photo || "";

    res.json({
      success: true,
      profile: {
        ...profile.toObject(),
        photo: imageUrl,
        profileImageUrl: imageUrl,
        profileImagePublicId:
          user?.profileImagePublicId || profile.profileImagePublicId || "",
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
