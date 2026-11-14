const Pharmacy = require("../models/pharmacy");
const User = require("../models/user");

// ============================================================
// ADD PHARMACY
// ============================================================

const addPharmacy = async (req, res) => {
  try {
    const {
      name,
      shopType,
      experience,
      address,
      phone,
    } = req.body;

    if (
      !name ||
      !shopType ||
      !experience ||
      !address ||
      !phone
    ) {
      return res.status(400).json({
        success: false,
        message: "All pharmacy fields are required.",
      });
    }

    const pharmacyPhone = phone.toString().trim();

    const existingPharmacy = await Pharmacy.findOne({
      phone: pharmacyPhone,
    });

    if (existingPharmacy) {
      return res.status(409).json({
        success: false,
        message:
          "Pharmacy with this phone number already exists.",
      });
    }

    const pharmacy = new Pharmacy({
      name: name.toString().trim(),
      shopType: shopType.toString().trim(),
      experience: experience.toString().trim(),
      address: address.toString().trim(),
      phone: pharmacyPhone,
      deliveryPartners: [],
    });

    await pharmacy.save();

    console.log(
      "✅ PHARMACY ADDED:",
      pharmacy._id.toString()
    );

    return res.status(201).json({
      success: true,
      message: "Pharmacy added successfully.",
      pharmacy,
    });
  } catch (error) {
    console.error(
      "❌ ADD PHARMACY ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "Failed to add pharmacy.",
    });
  }
};

// ============================================================
// GET ALL PHARMACIES
// ============================================================

const getPharmacies = async (req, res) => {
  try {
    const pharmacies = await Pharmacy.find()
      .sort({ createdAt: -1 });
    const phones = [...new Set(pharmacies.map((item) => item.phone).filter(Boolean))];
    const users = phones.length
      ? await User.find({ role: "pharmacy", phone: { $in: phones } })
          .select("phone profileImage profileImagePublicId")
          .lean()
      : [];
    const usersByPhone = new Map(users.map((user) => [user.phone, user]));
    const pharmaciesWithImages = pharmacies.map((pharmacy) => {
      const serialized = pharmacy.toObject();
      const owner = usersByPhone.get(pharmacy.phone);
      serialized.profileImageUrl =
        owner?.profileImage || serialized.profileImageUrl || serialized.image || "";
      serialized.profileImagePublicId =
        owner?.profileImagePublicId || serialized.profileImagePublicId || "";
      return serialized;
    });

    return res.status(200).json({
      success: true,
      pharmacies: pharmaciesWithImages,
    });
  } catch (error) {
    console.error(
      "❌ GET PHARMACIES ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "Failed to fetch pharmacies.",
      pharmacies: [],
    });
  }
};

// ============================================================
// GET PHARMACY PROFILE
// ============================================================

const getPharmacyProfile = async (req, res) => {
  try {
    const pharmacyPhone =
      req.params.phone?.toString().trim();

    console.log(
      "================================="
    );
    console.log(
      "GET PHARMACY PROFILE"
    );
    console.log(
      "PHONE =",
      pharmacyPhone
    );
    console.log(
      "================================="
    );

    if (!pharmacyPhone) {
      return res.status(400).json({
        success: false,
        message:
          "Pharmacy phone number is required.",
      });
    }

    const pharmacy = await Pharmacy.findOne({
      phone: pharmacyPhone,
    });

    if (!pharmacy) {
      return res.status(404).json({
        success: false,
        message: "Pharmacy not found.",
      });
    }

    const owner = await User.findOne({
      phone: pharmacyPhone,
      role: "pharmacy",
    }).select("profileImage profileImagePublicId").lean();

    return res.status(200).json({
      success: true,
      pharmacy: {
        ...pharmacy.toObject(),
        profileImageUrl:
          owner?.profileImage || pharmacy.profileImageUrl || pharmacy.image || "",
        profileImagePublicId:
          owner?.profileImagePublicId || pharmacy.profileImagePublicId || "",
      },
    });
  } catch (error) {
    console.error(
      "❌ GET PHARMACY PROFILE ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "Failed to fetch pharmacy profile.",
    });
  }
};

// ============================================================
// GET DELIVERY PARTNERS
// ============================================================

const getDeliveryPartners = async (req, res) => {
  try {
    const pharmacyPhone =
      req.params.phone?.toString().trim();

    console.log(
      "================================="
    );

    console.log(
      "GET DELIVERY PARTNERS"
    );

    console.log(
      "PHARMACY PHONE =",
      pharmacyPhone
    );

    console.log(
      "================================="
    );

    if (!pharmacyPhone) {
      return res.status(400).json({
        success: false,
        message:
          "Pharmacy phone number is required.",
        deliveryPartners: [],
      });
    }

    const pharmacy = await Pharmacy.findOne({
      phone: pharmacyPhone,
    });

    if (!pharmacy) {
      return res.status(404).json({
        success: false,
        message: "Pharmacy not found.",
        deliveryPartners: [],
      });
    }

    return res.status(200).json({
      success: true,
      deliveryPartners:
        pharmacy.deliveryPartners || [],
    });
  } catch (error) {
    console.error(
      "❌ GET DELIVERY PARTNERS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "Failed to get delivery partners.",
      deliveryPartners: [],
    });
  }
};

// ============================================================
// ADD DELIVERY PARTNER
// ============================================================

const addDeliveryPartner = async (req, res) => {
  try {
    const pharmacyPhone =
      req.params.phone?.toString().trim();

    const name =
      req.body.name?.toString().trim();

    const phone =
      req.body.phone?.toString().trim();

    console.log(
      "================================="
    );

    console.log(
      "ADD DELIVERY PARTNER"
    );

    console.log(
      "PHARMACY PHONE =",
      pharmacyPhone
    );

    console.log(
      "PARTNER NAME =",
      name
    );

    console.log(
      "PARTNER PHONE =",
      phone
    );

    console.log(
      "================================="
    );

    // ----------------------------------------------------------
    // VALIDATION
    // ----------------------------------------------------------

    if (!pharmacyPhone) {
      return res.status(400).json({
        success: false,
        message:
          "Pharmacy phone number is required.",
      });
    }

    if (!name) {
      return res.status(400).json({
        success: false,
        message:
          "Delivery partner name is required.",
      });
    }

    if (!phone) {
      return res.status(400).json({
        success: false,
        message:
          "Delivery partner phone is required.",
      });
    }

    // ----------------------------------------------------------
    // FIND PHARMACY
    // ----------------------------------------------------------

    const pharmacy = await Pharmacy.findOne({
      phone: pharmacyPhone,
    });

    if (!pharmacy) {
      return res.status(404).json({
        success: false,
        message: "Pharmacy not found.",
      });
    }

    // ----------------------------------------------------------
    // MAKE SURE ARRAY EXISTS
    // ----------------------------------------------------------

    if (!Array.isArray(pharmacy.deliveryPartners)) {
      pharmacy.deliveryPartners = [];
    }

    // ----------------------------------------------------------
    // CHECK DUPLICATE PARTNER PHONE
    // ----------------------------------------------------------

    const duplicate =
      pharmacy.deliveryPartners.some(
        (partner) =>
          partner.phone?.toString().trim() ===
          phone
      );

    if (duplicate) {
      return res.status(409).json({
        success: false,
        message:
          "A delivery partner with this phone number already exists.",
      });
    }

    // ----------------------------------------------------------
    // ADD PARTNER
    // ----------------------------------------------------------

    pharmacy.deliveryPartners.push({
      name: name,
      phone: phone,
      createdAt: new Date(),
    });

    await pharmacy.save();

    // ----------------------------------------------------------
    // GET ADDED PARTNER
    // ----------------------------------------------------------

    const addedPartner =
      pharmacy.deliveryPartners[
        pharmacy.deliveryPartners.length - 1
      ];

    console.log(
      "================================="
    );

    console.log(
      "✅ DELIVERY PARTNER ADDED"
    );

    console.log(
      "PARTNER ID =",
      addedPartner._id
    );

    console.log(
      "PARTNER NAME =",
      addedPartner.name
    );

    console.log(
      "PARTNER PHONE =",
      addedPartner.phone
    );

    console.log(
      "================================="
    );

    return res.status(201).json({
      success: true,
      message:
        "Delivery partner added successfully.",

      deliveryPartner: addedPartner,

      deliveryPartners:
        pharmacy.deliveryPartners,
    });
  } catch (error) {
    console.error(
      "❌ ADD DELIVERY PARTNER ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "Failed to add delivery partner.",
    });
  }
};

// ============================================================
// DELETE DELIVERY PARTNER
// ============================================================

const deleteDeliveryPartner = async (req, res) => {
  try {
    const pharmacyPhone =
      req.params.phone?.toString().trim();

    const partnerId =
      req.params.partnerId?.toString().trim();

    console.log(
      "================================="
    );

    console.log(
      "DELETE DELIVERY PARTNER"
    );

    console.log(
      "PHARMACY PHONE =",
      pharmacyPhone
    );

    console.log(
      "PARTNER ID =",
      partnerId
    );

    console.log(
      "================================="
    );

    // ----------------------------------------------------------
    // VALIDATION
    // ----------------------------------------------------------

    if (!pharmacyPhone) {
      return res.status(400).json({
        success: false,
        message:
          "Pharmacy phone number is required.",
      });
    }

    if (!partnerId) {
      return res.status(400).json({
        success: false,
        message:
          "Delivery partner ID is required.",
      });
    }

    // ----------------------------------------------------------
    // FIND PHARMACY
    // ----------------------------------------------------------

    const pharmacy = await Pharmacy.findOne({
      phone: pharmacyPhone,
    });

    if (!pharmacy) {
      return res.status(404).json({
        success: false,
        message: "Pharmacy not found.",
      });
    }

    // ----------------------------------------------------------
    // CHECK ARRAY
    // ----------------------------------------------------------

    if (!Array.isArray(pharmacy.deliveryPartners)) {
      return res.status(404).json({
        success: false,
        message:
          "No delivery partners found.",
      });
    }

    // ----------------------------------------------------------
    // FIND PARTNER
    // ----------------------------------------------------------

    const partnerIndex =
      pharmacy.deliveryPartners.findIndex(
        (partner) =>
          partner._id?.toString() ===
          partnerId
      );

    if (partnerIndex === -1) {
      return res.status(404).json({
        success: false,
        message:
          "Delivery partner not found.",
      });
    }

    // ----------------------------------------------------------
    // STORE REMOVED PARTNER
    // ----------------------------------------------------------

    const removedPartner =
      pharmacy.deliveryPartners[
        partnerIndex
      ];

    // ----------------------------------------------------------
    // REMOVE PARTNER
    // ----------------------------------------------------------

    pharmacy.deliveryPartners.splice(
      partnerIndex,
      1
    );

    await pharmacy.save();

    console.log(
      "================================="
    );

    console.log(
      "✅ DELIVERY PARTNER DELETED"
    );

    console.log(
      "REMOVED PARTNER ID =",
      partnerId
    );

    console.log(
      "REMOVED PARTNER NAME =",
      removedPartner.name
    );

    console.log(
      "================================="
    );

    return res.status(200).json({
      success: true,
      message:
        "Delivery partner deleted successfully.",

      deliveryPartners:
        pharmacy.deliveryPartners,
    });
  } catch (error) {
    console.error(
      "❌ DELETE DELIVERY PARTNER ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "Failed to delete delivery partner.",
    });
  }
};

// ============================================================
// EXPORT ALL FUNCTIONS
// ============================================================

module.exports = {
  addPharmacy,
  getPharmacies,
  getPharmacyProfile,

  getDeliveryPartners,
  addDeliveryPartner,
  deleteDeliveryPartner,
};
