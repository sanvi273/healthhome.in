const crypto = require("crypto");

const Order = require("../models/orderModel");
const Medicine = require("../models/medicine");
const Pharmacy = require("../models/pharmacy");
const User = require("../models/user");

// ============================================================
// HELPER: NORMALIZE PAYMENT METHOD
// ============================================================

const normalizePaymentMethod = (paymentMethod) => {
  if (
    paymentMethod === "ONLINE" ||
    paymentMethod === "COD"
  ) {
    return paymentMethod;
  }

  if (paymentMethod === "Cash on Delivery") {
    return "COD";
  }

  return "COD";
};

// ============================================================
// HELPER: GENERATE DELIVERY OTP
// ============================================================

const generateDeliveryOtp = () => {
  return crypto
    .randomInt(100000, 1000000)
    .toString();
};

// ============================================================
// HELPER: HASH DELIVERY OTP
// ============================================================

const hashDeliveryOtp = (otp) => {
  return crypto
    .createHash("sha256")
    .update(otp)
    .digest("hex");
};

// ============================================================
// DEMO ONLY: TEMPORARY DELIVERY OTP STORE
// ============================================================
//
// MongoDB stores only the HASH of the OTP.
// For this demo, we temporarily keep the real OTP
// in server memory so the Patient app can display it.
//
// NOTE:
// This is ONLY for testing/demo.
// Server restart will clear this memory.
// ============================================================

const deliveryOtpStore = new Map();

const saveDeliveryOtpForDemo = (
  orderId,
  otp,
  expiresAt
) => {
  deliveryOtpStore.set(
    String(orderId),
    {
      otp: String(otp),
      expiresAt: new Date(expiresAt).getTime(),
    }
  );
};

const getDeliveryOtpFromDemoStore = (
  orderId
) => {
  const entry =
    deliveryOtpStore.get(
      String(orderId)
    );

  if (!entry) {
    return null;
  }

  // OTP expired
  if (
    Date.now() >
    entry.expiresAt
  ) {
    deliveryOtpStore.delete(
      String(orderId)
    );

    return null;
  }

  return entry.otp;
};

// ============================================================
// HELPER: REPAIR / RECALCULATE ORDER AMOUNTS
// ============================================================

const repairOrderAmounts = async (order) => {
  try {
    // ========================================================
    // PRESCRIPTION ORDER WITHOUT MEDICINES
    // ========================================================

    if (
      order.orderType === "PRESCRIPTION" &&
      (!Array.isArray(order.medicines) ||
        order.medicines.length === 0)
    ) {
      order.medicines = [];

      order.subtotal = 0;

      order.deliveryFee =
        Number(order.deliveryFee) || 0;

      order.discount =
        Number(order.discount) || 0;

      order.totalAmount = Math.max(
        0,
        order.deliveryFee -
          order.discount
      );

      order.platformFee =
        Number(order.platformFee) || 0;

      order.providerAmount = Math.max(
        0,
        order.totalAmount -
          order.platformFee
      );

      return {
        success: true,
        subtotal: 0,
        totalAmount: order.totalAmount,
      };
    }

    // ========================================================
    // LEGACY PRESCRIPTION ORDER DETECTION
    // ========================================================

    if (
      (!order.orderType ||
        order.orderType === "MEDICINE") &&
      Array.isArray(order.medicines) &&
      order.medicines.length === 1 &&
      (
        !order.medicines[0].medicineId ||
        order.medicines[0].medicineName ===
          "Prescription Order"
      ) &&
      order.prescriptionImage
    ) {
      order.orderType =
        "PRESCRIPTION";

      order.medicines = [];

      order.subtotal = 0;

      order.deliveryFee =
        Number(order.deliveryFee) || 0;

      order.discount =
        Number(order.discount) || 0;

      order.totalAmount = Math.max(
        0,
        order.deliveryFee -
          order.discount
      );

      order.platformFee =
        Number(order.platformFee) || 0;

      order.providerAmount = Math.max(
        0,
        order.totalAmount -
          order.platformFee
      );

      return {
        success: true,
        subtotal: 0,
        totalAmount: order.totalAmount,
      };
    }

    // ========================================================
    // MEDICINE ORDER VALIDATION
    // ========================================================

    if (
      !Array.isArray(order.medicines) ||
      order.medicines.length === 0
    ) {
      return {
        success: false,
        message:
          "Order does not contain any medicines.",
      };
    }

    let calculatedSubtotal = 0;

    // ========================================================
    // REPAIR EACH MEDICINE
    // ========================================================

    for (const item of order.medicines) {
      const quantity =
        Number(item.quantity);

      if (
        !Number.isInteger(quantity) ||
        quantity <= 0
      ) {
        return {
          success: false,
          message:
            `Invalid quantity for medicine ${
              item.medicineName ||
              item.medicineId ||
              ""
            }.`,
        };
      }

      // ------------------------------------------------------
      // PRICE
      // ------------------------------------------------------

      let price =
        Number(item.price);

      if (
        !Number.isFinite(price) ||
        price < 0
      ) {
        if (!item.medicineId) {
          return {
            success: false,
            message:
              `Price is missing for medicine ${
                item.medicineName || ""
              }.`,
          };
        }

        let medicine = null;

        try {
          medicine =
            await Medicine.findById(
              item.medicineId
            );
        } catch (error) {
          return {
            success: false,
            message:
              "Invalid medicine ID while repairing order.",
          };
        }

        if (!medicine) {
          return {
            success: false,
            message:
              `Medicine not found: ${item.medicineId}`,
          };
        }

        price =
          Number(medicine.price);

        if (
          !Number.isFinite(price) ||
          price < 0
        ) {
          return {
            success: false,
            message:
              `Invalid price for ${
                medicine.medicineName ||
                item.medicineId
              }.`,
          };
        }

        item.price = price;
      }

      // ------------------------------------------------------
      // SUBTOTAL
      // ------------------------------------------------------

      const itemSubtotal =
        price * quantity;

      if (
        !Number.isFinite(itemSubtotal) ||
        itemSubtotal < 0
      ) {
        return {
          success: false,
          message:
            `Unable to calculate subtotal for ${
              item.medicineName ||
              item.medicineId ||
              ""
            }.`,
        };
      }

      item.subtotal =
        itemSubtotal;

      calculatedSubtotal +=
        itemSubtotal;
    }

    // ========================================================
    // ORDER SUBTOTAL
    // ========================================================

    if (
      !Number.isFinite(
        calculatedSubtotal
      )
    ) {
      return {
        success: false,
        message:
          "Invalid calculated order subtotal.",
      };
    }

    // ========================================================
    // DELIVERY FEE
    // ========================================================

    const deliveryFee =
      Number(order.deliveryFee) || 0;

    // ========================================================
    // DISCOUNT
    // ========================================================

    const discount =
      Number(order.discount) || 0;

    // ========================================================
    // TOTAL
    // ========================================================

    const totalAmount =
      calculatedSubtotal +
      deliveryFee -
      discount;

    if (
      !Number.isFinite(totalAmount) ||
      totalAmount < 0
    ) {
      return {
        success: false,
        message:
          "Invalid calculated order total.",
      };
    }

    // ========================================================
    // PLATFORM FEE
    // ========================================================

    const platformFee =
      Number(order.platformFee) || 0;

    const providerAmount =
      Math.max(
        0,
        totalAmount -
          platformFee
      );

    // ========================================================
    // UPDATE ORDER
    // ========================================================

    order.subtotal =
      calculatedSubtotal;

    order.deliveryFee =
      deliveryFee;

    order.discount =
      discount;

    order.totalAmount =
      totalAmount;

    order.platformFee =
      platformFee;

    order.providerAmount =
      providerAmount;

    return {
      success: true,
      subtotal:
        calculatedSubtotal,
      totalAmount,
    };
  } catch (error) {
    console.error(
      "REPAIR ORDER AMOUNTS ERROR:",
      error
    );

    return {
      success: false,
      message:
        error.message ||
        "Unable to repair order amounts.",
    };
  }
};

// ============================================================
// HELPER: FIND PHARMACY
// ============================================================

const findPharmacy = async ({
  pharmacyId,
  pharmacyPhone,
}) => {
  let pharmacy = null;

  if (pharmacyId) {
    try {
      pharmacy =
        await Pharmacy.findById(
          pharmacyId
        );
    } catch (error) {
      return null;
    }
  }

  if (
    !pharmacy &&
    pharmacyPhone
  ) {
    pharmacy =
      await Pharmacy.findOne({
        phone: pharmacyPhone,
      });
  }

  return pharmacy;
};

const placeOrder = async (
  req,
  res
) => {
  try {
    console.log("");
    console.log(
      "=================================================="
    );
    console.log(
      "========== NEW MEDICINE ORDER ===================="
    );
    console.log(
      "=================================================="
    );

    console.log(
      "REQUEST BODY =",
      JSON.stringify(
        req.body,
        null,
        2
      )
    );

    const {
      patientId,
      patientName,
      patientPhone,

      pharmacyId,
      pharmacyName,
      pharmacyPhone,

      address,
      notes,
      prescriptionImage,

      medicines,

      paymentMethod,
    } = req.body;

    // ========================================================
    // VALIDATION
    // ========================================================

    if (
      !patientName ||
      !patientPhone
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Patient name and phone are required.",
      });
    }

    if (!address) {
      return res.status(400).json({
        success: false,
        message:
          "Delivery address is required.",
      });
    }

    if (
      !Array.isArray(medicines) ||
      medicines.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "At least one medicine is required.",
      });
    }

    // ========================================================
    // PHARMACY
    // ========================================================

    const pharmacy =
      await findPharmacy({
        pharmacyId,
        pharmacyPhone,
      });

    if (!pharmacy) {
      return res.status(404).json({
        success: false,
        message:
          "Pharmacy not found.",
      });
    }

    if (
      pharmacy.available ===
      false
    ) {
      return res.status(400).json({
        success: false,
        message:
          "This pharmacy is currently unavailable.",
      });
    }

    // ========================================================
    // PAYMENT
    // ========================================================

    const finalPaymentMethod =
      normalizePaymentMethod(
        paymentMethod
      );

    // ========================================================
    // VERIFY MEDICINES
    // ========================================================

    const verifiedMedicines = [];

    let subtotal = 0;

    for (
      const item of medicines
    ) {
      const medicineId =
        item.medicineId;

      const quantity =
        Number(
          item.quantity
        );

      if (
        !medicineId ||
        !Number.isInteger(
          quantity
        ) ||
        quantity <= 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid medicine ID or quantity.",
        });
      }

      let medicine = null;

      try {
        medicine =
          await Medicine.findById(
            medicineId
          );
      } catch (error) {
        return res.status(400).json({
          success: false,
          message:
            `Invalid medicine ID: ${medicineId}`,
        });
      }

      if (!medicine) {
        return res.status(404).json({
          success: false,
          message:
            `Medicine not found: ${medicineId}`,
        });
      }

      // ------------------------------------------------------
      // CHECK PHARMACY
      // ------------------------------------------------------

      if (
        pharmacy.phone &&
        medicine.pharmacyPhone &&
        String(
          medicine.pharmacyPhone
        ).trim() !==
          String(
            pharmacy.phone
          ).trim()
      ) {
        return res.status(400).json({
          success: false,
          message:
            `${medicine.medicineName} does not belong to the selected pharmacy.`,
        });
      }

      // ------------------------------------------------------
      // STOCK
      // ------------------------------------------------------

      const stock =
        Number(
          medicine.stock
        );

      if (
        !Number.isFinite(stock) ||
        stock < quantity
      ) {
        return res.status(400).json({
          success: false,
          message:
            `${medicine.medicineName} has only ${medicine.stock} item(s) available.`,
        });
      }

      // ------------------------------------------------------
      // DATABASE PRICE
      // ------------------------------------------------------

      const actualPrice =
        Number(
          medicine.price
        );

      if (
        !Number.isFinite(
          actualPrice
        ) ||
        actualPrice < 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            `Invalid price for ${medicine.medicineName}.`,
        });
      }

      const itemSubtotal =
        actualPrice *
        quantity;

      subtotal +=
        itemSubtotal;

      verifiedMedicines.push({
        medicineId:
          String(
            medicine._id
          ),

        medicineName:
          medicine.medicineName,

        quantity,

        price:
          actualPrice,

        subtotal:
          itemSubtotal,
      });
    }

    // ========================================================
    // FINAL TOTAL
    // ========================================================

    const deliveryFee = 0;
    const discount = 0;

    const totalAmount =
      subtotal +
      deliveryFee -
      discount;

    const platformFee = 0;

    const providerAmount =
      Math.max(
        0,
        totalAmount -
          platformFee
      );

    // ========================================================
    // CREATE ORDER
    // ========================================================

    const order =
      await Order.create({
        patientId:
          patientId || "",

        patientName:
          String(
            patientName
          ).trim(),

        patientPhone:
          String(
            patientPhone
          ).trim(),

        pharmacyId:
          String(
            pharmacy._id
          ),

        pharmacyName:
          pharmacy.name ||
          pharmacyName ||
          "",

        pharmacyPhone:
          pharmacy.phone ||
          pharmacyPhone ||
          "",

        orderType:
          "MEDICINE",

        address:
          String(
            address
          ).trim(),

        notes:
          notes || "",

        prescriptionImage:
          prescriptionImage ||
          "",

        medicines:
          verifiedMedicines,

        subtotal,

        deliveryFee,

        discount,

        totalAmount,

        currency:
          "INR",

        paymentMethod:
          finalPaymentMethod,

        paymentStatus:
          "Pending",

        settlementStatus:
          "Pending",

        platformFee,

        providerAmount,

        cashCollected:
          false,

        cashCollectedAt:
          null,

        deliveryAgentName:
          "",

        deliveryAgentPhone:
          "",

        deliveryAgentAssigned:
          false,

        deliveryAgentAssignedAt:
          null,

        acceptedAt:
          null,

        status:
          "Pending",
      });

    console.log(
      "MEDICINE ORDER CREATED:",
      order._id
    );

    console.log(
      "TOTAL =",
      order.totalAmount
    );

    return res.status(201).json({
      success: true,

      message:
        "Medicine order placed successfully.",

      order: {
        id:
          order._id,

        orderType:
          order.orderType,

        patientId:
          order.patientId,

        patientName:
          order.patientName,

        patientPhone:
          order.patientPhone,

        pharmacyId:
          order.pharmacyId,

        pharmacyName:
          order.pharmacyName,

        pharmacyPhone:
          order.pharmacyPhone,

        address:
          order.address,

        notes:
          order.notes,

        prescriptionImage:
          order.prescriptionImage,

        medicines:
          order.medicines,

        subtotal:
          Number(
            order.subtotal
          ),

        deliveryFee:
          Number(
            order.deliveryFee
          ),

        discount:
          Number(
            order.discount
          ),

        totalAmount:
          Number(
            order.totalAmount
          ),

        currency:
          order.currency,

        paymentMethod:
          order.paymentMethod,

        paymentStatus:
          order.paymentStatus,

        status:
          order.status,

        acceptedAt:
          order.acceptedAt,

        createdAt:
          order.createdAt,
      },
    });
  } catch (error) {
    console.error(
      "PLACE MEDICINE ORDER ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "Unable to place medicine order.",
    });
  }
};

// ============================================================
// PLACE PRESCRIPTION IMAGE ORDER
// ============================================================

const placePrescriptionOrder =
  async (
    req,
    res
  ) => {
    try {
      console.log("");
      console.log(
        "=================================================="
      );
      console.log(
        "======= NEW PRESCRIPTION ORDER ==================="
      );
      console.log(
        "=================================================="
      );

      const {
        patientId,
        patientName,
        patientPhone,

        pharmacyId,
        pharmacyName,
        pharmacyPhone,

        address,
        notes,
        prescriptionImage,
      } = req.body;

      // ======================================================
      // VALIDATION
      // ======================================================

      if (
        !patientName ||
        !patientPhone
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Patient name and phone are required.",
        });
      }

      if (!address) {
        return res.status(400).json({
          success: false,
          message:
            "Delivery address is required.",
        });
      }

      if (
        !prescriptionImage ||
        !String(
          prescriptionImage
        ).trim()
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Prescription image is required.",
        });
      }

      // ======================================================
      // PHARMACY
      // ======================================================

      const pharmacy =
        await findPharmacy({
          pharmacyId,
          pharmacyPhone,
        });

      if (!pharmacy) {
        return res.status(404).json({
          success: false,
          message:
            "Pharmacy not found.",
        });
      }

      if (
        pharmacy.available ===
        false
      ) {
        return res.status(400).json({
          success: false,
          message:
            "This pharmacy is currently unavailable.",
        });
      }

      // ======================================================
      // CREATE PRESCRIPTION ORDER
      // ======================================================

      const order =
        await Order.create({
          patientId:
            patientId || "",

          patientName:
            String(
              patientName
            ).trim(),

          patientPhone:
            String(
              patientPhone
            ).trim(),

          pharmacyId:
            String(
              pharmacy._id
            ),

          pharmacyName:
            pharmacy.name ||
            pharmacyName ||
            "",

          pharmacyPhone:
            pharmacy.phone ||
            pharmacyPhone ||
            "",

          orderType:
            "PRESCRIPTION",

          address:
            String(
              address
            ).trim(),

          notes:
            notes || "",

          prescriptionImage:
            String(
              prescriptionImage
            ).trim(),

          medicines: [],

          // Prescription processing fee
          subtotal: 500,

          deliveryFee: 0,

          discount: 0,

          totalAmount: 500,

          paymentMethod:
            "ONLINE",

          paymentStatus:
            "Pending",

          settlementStatus:
            "Pending",

          platformFee: 0,

          providerAmount: 0,

          cashCollected:
            false,

          cashCollectedAt:
            null,

          deliveryAgentName:
            "",

          deliveryAgentPhone:
            "",

          deliveryAgentAssigned:
            false,

          deliveryAgentAssignedAt:
            null,

          acceptedAt:
            null,

          status:
            "Pending",
        });

      console.log(
        "PRESCRIPTION ORDER CREATED:",
        order._id
      );

      return res.status(201).json({
        success: true,

        message:
          "Prescription order placed successfully.",

        order: {
          id:
            order._id,

          orderType:
            order.orderType,

          patientId:
            order.patientId,

          patientName:
            order.patientName,

          patientPhone:
            order.patientPhone,

          pharmacyId:
            order.pharmacyId,

          pharmacyName:
            order.pharmacyName,

          pharmacyPhone:
            order.pharmacyPhone,

          address:
            order.address,

          notes:
            order.notes,

          prescriptionImage:
            order.prescriptionImage,

          medicines:
            order.medicines,

          subtotal:
            Number(
              order.subtotal
            ),

          deliveryFee:
            Number(
              order.deliveryFee
            ),

          discount:
            Number(
              order.discount
            ),

          totalAmount:
            Number(
              order.totalAmount
            ),

          currency:
            order.currency,

          paymentMethod:
            order.paymentMethod,

          paymentStatus:
            order.paymentStatus,

          status:
            order.status,

          createdAt:
            order.createdAt,
        },
      });
    } catch (error) {
      console.error(
        "PLACE PRESCRIPTION ORDER ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          error.message ||
          "Unable to place prescription order.",
      });
    }
  };

// ============================================================
// CONFIRM PRESCRIPTION ORDER
// ============================================================

const confirmPrescriptionOrder =
  async (
    req,
    res
  ) => {
    try {
      const {
        medicines,
        deliveryFee = 0,
        discount = 0,
      } = req.body;

      // ======================================================
      // FIND ORDER
      // ======================================================

      const order =
        await Order.findById(
          req.params.id
        );

      if (!order) {
        return res.status(404).json({
          success: false,
          message:
            "Order not found.",
        });
      }

      // ======================================================
      // ORDER TYPE
      // ======================================================

      if (
        order.orderType !==
        "PRESCRIPTION"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "This is not a prescription order.",
        });
      }

      // ======================================================
      // STATUS
      // ======================================================

      if (
        order.status !==
          "Pending" &&
        order.status !==
          "Accepted"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Prescription can only be confirmed while the order is Pending or Accepted.",
        });
      }

      // ======================================================
      // MEDICINES
      // ======================================================

      if (
        !Array.isArray(
          medicines
        ) ||
        medicines.length === 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "At least one medicine is required.",
        });
      }

      const verifiedMedicines =
        [];

      let subtotal = 0;

      // ======================================================
      // VERIFY MEDICINES
      // ======================================================

      for (
        const item of medicines
      ) {
        const medicineId =
          item.medicineId;

        const quantity =
          Number(
            item.quantity
          );

        if (
          !medicineId ||
          !Number.isInteger(
            quantity
          ) ||
          quantity <= 0
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid medicine ID or quantity.",
          });
        }

        let medicine = null;

        try {
          medicine =
            await Medicine.findById(
              medicineId
            );
        } catch (error) {
          return res.status(400).json({
            success: false,
            message:
              `Invalid medicine ID: ${medicineId}`,
          });
        }

        if (!medicine) {
          return res.status(404).json({
            success: false,
            message:
              `Medicine not found: ${medicineId}`,
          });
        }

        // ----------------------------------------------------
        // CHECK PHARMACY
        // ----------------------------------------------------

        if (
          order.pharmacyPhone &&
          medicine.pharmacyPhone &&
          String(
            medicine.pharmacyPhone
          ).trim() !==
            String(
              order.pharmacyPhone
            ).trim()
        ) {
          return res.status(400).json({
            success: false,
            message:
              `${medicine.medicineName} does not belong to this pharmacy.`,
          });
        }

        // ----------------------------------------------------
        // STOCK
        // ----------------------------------------------------

        const stock =
          Number(
            medicine.stock
          );

        if (
          !Number.isFinite(stock) ||
          stock < quantity
        ) {
          return res.status(400).json({
            success: false,
            message:
              `${medicine.medicineName} has only ${medicine.stock} item(s) available.`,
          });
        }

        // ----------------------------------------------------
        // DATABASE PRICE
        // ----------------------------------------------------

        const price =
          Number(
            medicine.price
          );

        if (
          !Number.isFinite(price) ||
          price < 0
        ) {
          return res.status(400).json({
            success: false,
            message:
              `Invalid price for ${medicine.medicineName}.`,
          });
        }

        const itemSubtotal =
          price * quantity;

        subtotal +=
          itemSubtotal;

        verifiedMedicines.push({
          medicineId:
            String(
              medicine._id
            ),

          medicineName:
            medicine.medicineName,

          quantity,

          price,

          subtotal:
            itemSubtotal,
        });
      }

      // ======================================================
      // FEES
      // ======================================================

      const finalDeliveryFee =
        Number(
          deliveryFee
        ) || 0;

      const finalDiscount =
        Number(
          discount
        ) || 0;

      if (
        finalDeliveryFee < 0 ||
        finalDiscount < 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid delivery fee or discount.",
        });
      }

      // ======================================================
      // TOTAL
      // ======================================================

      const totalAmount =
        subtotal +
        finalDeliveryFee -
        finalDiscount;

      if (
        !Number.isFinite(
          totalAmount
        ) ||
        totalAmount < 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid calculated total.",
        });
      }

      // ======================================================
      // PLATFORM FEE
      // ======================================================

      const platformFee =
        Number(
          order.platformFee
        ) || 0;

      const providerAmount =
        Math.max(
          0,
          totalAmount -
            platformFee
        );

      // ======================================================
      // UPDATE ORDER
      // ======================================================

      order.medicines =
        verifiedMedicines;

      order.subtotal =
        subtotal;

      order.deliveryFee =
        finalDeliveryFee;

      order.discount =
        finalDiscount;

      order.totalAmount =
        totalAmount;

      order.providerAmount =
        providerAmount;

      // ======================================================
      // ACCEPT ORDER
      // ======================================================

      order.status =
        "Accepted";

      // IMPORTANT:
      // Save exact acceptance time.

      if (!order.acceptedAt) {
        order.acceptedAt =
          new Date();
      }

      await order.save();

      console.log(
        "PRESCRIPTION ORDER CONFIRMED"
      );

      console.log(
        "ORDER ID =",
        order._id
      );

      console.log(
        "TOTAL =",
        order.totalAmount
      );

      console.log(
        "ACCEPTED AT =",
        order.acceptedAt
      );

      return res.status(200).json({
        success: true,

        message:
          "Prescription order confirmed successfully.",

        order,
      });
    } catch (error) {
      console.error(
        "CONFIRM PRESCRIPTION ORDER ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          error.message ||
          "Unable to confirm prescription order.",
      });
    }
  };

// ============================================================
// GET PHARMACY ORDERS
// ============================================================

const getPharmacyOrders =
  async (
    req,
    res
  ) => {
    try {
      const pharmacyId =
        req.params.pharmacyId;

      const orders =
        await Order.find({
          pharmacyId,
        }).sort({
          createdAt: -1,
        });

      return res.status(200).json({
        success: true,

        total:
          orders.length,

        orders,
      });
    } catch (error) {
      console.error(
        "GET PHARMACY ORDERS ERROR:",
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
// GET PATIENT ORDERS
// ============================================================

const getPatientOrders =
  async (
    req,
    res
  ) => {
    try {
      const phone =
        req.params.phone;

      const orders =
        await Order.find({
          patientPhone: phone,
        }).sort({
          createdAt: -1,
        });

      return res.status(200).json({
        success: true,

        total:
          orders.length,

        orders,
      });
    } catch (error) {
      console.error(
        "GET PATIENT ORDERS ERROR:",
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
// GET DELIVERY OTP - PATIENT
// ============================================================
//
// Patient side calls this endpoint when the order is
// Out for Delivery.
//
// Demo/testing only.
// ============================================================

const getDeliveryOtp = async (
  req,
  res
) => {
  try {
    const orderId =
      req.params.id;

    // --------------------------------------------------------
    // FIND ORDER
    // --------------------------------------------------------

    const order =
      await Order.findById(
        orderId
      );

    if (!order) {
      return res.status(404).json({
        success: false,
        message:
          "Order not found.",
      });
    }

    // --------------------------------------------------------
    // STATUS CHECK
    // --------------------------------------------------------

    if (
      order.status !==
      "Out for Delivery"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Delivery OTP is available only when the order is Out for Delivery.",
      });
    }

    // --------------------------------------------------------
    // ALREADY VERIFIED
    // --------------------------------------------------------

    if (
      order.deliveryOtpVerified
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Delivery OTP has already been verified.",
      });
    }

    // --------------------------------------------------------
    // EXPIRY CHECK
    // --------------------------------------------------------

    if (
      !order.deliveryOtpExpiresAt ||
      new Date() >
        new Date(
          order.deliveryOtpExpiresAt
        )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Delivery OTP has expired.",
        expired: true,
      });
    }

    // --------------------------------------------------------
    // GET OTP FROM TEMPORARY MEMORY
    // --------------------------------------------------------

    const deliveryOtp =
      getDeliveryOtpFromDemoStore(
        orderId
      );

    if (!deliveryOtp) {
      return res.status(404).json({
        success: false,
        message:
          "Delivery OTP is no longer available in demo server memory. The server may have restarted.",
        testingOnly: true,
      });
    }

    // --------------------------------------------------------
    // SUCCESS
    // --------------------------------------------------------

    return res.status(200).json({
      success: true,

      deliveryOtp,

      deliveryOtpExpiresAt:
        order.deliveryOtpExpiresAt,

      testingOnly: true,
    });

  } catch (error) {
    console.error(
      "GET DELIVERY OTP ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "Unable to get delivery OTP.",
    });
  }
};

  // ============================================================
// UPDATE ORDER STATUS
// ============================================================

const updateOrderStatus =
  async (
    req,
    res
  ) => {
    try {
      const {
        status,
      } = req.body;

      const allowedStatuses = [
        "Pending",
        "Accepted",
        "Packed",
        "Out for Delivery",
        "Delivered",
        "Rejected",
        "Cancelled",
      ];

      if (
        !allowedStatuses.includes(
          status
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid order status.",
        });
      }

      const order =
        await Order.findById(
          req.params.id
        );

      if (!order) {
        return res.status(404).json({
          success: false,
          message:
            "Order not found.",
        });
      }

      // ======================================================
      // DELIVERY OTP SECURITY
      // ======================================================
      //
      // Delivered CANNOT be set directly.
      //
      // Delivery person must verify the
      // patient's OTP first.
      //
      // ======================================================

      if (
        status === "Delivered"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Delivery OTP verification is required before marking the order as Delivered.",
          requiresDeliveryOtp:
            true,
        });
      }

      // ======================================================
      // UNCONFIRMED PRESCRIPTION
      // ======================================================

      if (
        order.orderType ===
          "PRESCRIPTION" &&
        (!order.medicines ||
          order.medicines.length === 0)
      ) {
        // Pending is allowed.

        // Accepted must happen through
        // confirmPrescriptionOrder().

        if (
          status ===
          "Accepted"
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Please confirm the prescription medicines and amount before accepting this order.",
          });
        }

        if (
          status === "Packed" ||
          status ===
            "Out for Delivery"
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Prescription order must be confirmed before continuing delivery.",
          });
        }

        order.status =
          status;

        if (
          status ===
          "Cancelled"
        ) {
          order.cancelledAt =
            new Date();

          order.cancellationReason =
            req.body.reason ||
            "";
        }

        await order.save();

        return res.status(200).json({
          success: true,

          message:
            "Order status updated successfully.",

          order,
        });
      }

      // ======================================================
      // NORMAL MEDICINE ORDER
      // ======================================================

      const repairResult =
        await repairOrderAmounts(
          order
        );

      if (
        !repairResult.success
      ) {
        return res.status(400).json({
          success: false,
          message:
            repairResult.message,
        });
      }

      // ======================================================
      // DELIVERY PARTNER
      // ======================================================

      if (
        status ===
          "Out for Delivery" &&
        !order.deliveryAgentAssigned
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Delivery partner must be assigned before the order goes Out for Delivery.",
        });
      }

      // ======================================================
      // GENERATE DELIVERY OTP
      // ======================================================
      //
      // OTP is generated ONLY when the order
      // actually moves to Out for Delivery.
      //
      // OTP:
      // - 6 digits
      // - valid for 10 minutes
      // - SHA-256 hash stored in MongoDB
      // - actual OTP returned only for testing
      //
      // ======================================================

      let generatedDeliveryOtp =
        null;

      if (
        status ===
          "Out for Delivery" &&
        order.status !==
          "Out for Delivery"
      ) {
        generatedDeliveryOtp =
          generateDeliveryOtp();

        order.deliveryOtpHash =
          hashDeliveryOtp(
            generatedDeliveryOtp
          );

        order.deliveryOtpExpiresAt =
          new Date(
            Date.now() +
              10 * 60 * 1000
          );

          // Save plaintext OTP temporarily for Patient demo
saveDeliveryOtpForDemo(
  order._id,
  generatedDeliveryOtp,
  order.deliveryOtpExpiresAt
);

        order.deliveryOtpAttempts =
          0;

        order.deliveryOtpVerified =
          false;

        order.deliveryOtpSentAt =
          new Date();

        console.log("");
        console.log(
          "=================================================="
        );
        console.log(
          "========== PHARMACY DELIVERY OTP ================"
        );
        console.log(
          "=================================================="
        );
        console.log(
          "ORDER ID =",
          order._id
        );
        console.log(
          "PATIENT PHONE =",
          order.patientPhone
        );
        console.log(
          "DELIVERY OTP =",
          generatedDeliveryOtp
        );
        console.log(
          "EXPIRES AT =",
          order.deliveryOtpExpiresAt
        );
        console.log(
          "=================================================="
        );
      }

      // ======================================================
      // STATUS
      // ======================================================

      order.status =
        status;

      // ======================================================
      // ACCEPTED TIME
      // ======================================================

      if (
        status === "Accepted" &&
        !order.acceptedAt
      ) {
        order.acceptedAt =
          new Date();
      }

      // ======================================================
      // CANCELLATION
      // ======================================================

      if (
        status ===
        "Cancelled"
      ) {
        order.cancelledAt =
          new Date();

        order.cancellationReason =
          req.body.reason ||
          "";
      }

      await order.save();

      // ======================================================
      // RESPONSE
      // ======================================================

      const response = {
        success: true,

        message:
          "Order status updated successfully.",

        order,
      };

      // ======================================================
      // TESTING ONLY
      // ======================================================
      //
      // Currently MSG91 is NOT being used.
      //
      // Therefore return the OTP in the API response
      // so we can test the complete flow.
      //
      // Later, when Patient-side OTP UI is ready,
      // this can be changed.
      //
      // ======================================================

      if (
        generatedDeliveryOtp
      ) {
        response.deliveryOtp =
          generatedDeliveryOtp;

        response.deliveryOtpExpiresAt =
          order.deliveryOtpExpiresAt;

        response.testingOnly =
          true;
      }

      return res.status(200).json(
        response
      );
    } catch (error) {
      console.error(
        "UPDATE ORDER STATUS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          error.message ||
          "Unable to update order status.",
      });
    }
  };

  // ============================================================
// ASSIGN DELIVERY PARTNER
// ============================================================

const assignDeliveryAgent =
  async (
    req,
    res
  ) => {
    try {
      const {
        deliveryAgentName,
        deliveryAgentPhone,
      } = req.body;

      if (
        !deliveryAgentName ||
        !String(
          deliveryAgentName
        ).trim()
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Delivery partner name is required.",
        });
      }

      if (
        !deliveryAgentPhone ||
        !String(
          deliveryAgentPhone
        ).trim()
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Delivery partner phone is required.",
        });
      }

      const order =
        await Order.findById(
          req.params.id
        );

      if (!order) {
        return res.status(404).json({
          success: false,
          message:
            "Order not found.",
        });
      }

      if (
        order.status !==
          "Accepted" &&
        order.status !==
          "Packed"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Delivery partner can only be assigned after the order is accepted.",
        });
      }

      // ======================================================
      // PRESCRIPTION ORDER
      // ======================================================

      if (
        order.orderType ===
          "PRESCRIPTION" &&
        (
          !order.medicines ||
          order.medicines.length === 0 ||
          Number(
            order.totalAmount
          ) <= 0
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Prescription order must be confirmed with medicines and final amount first.",
        });
      }

      // ======================================================
      // REPAIR ORDER AMOUNT
      // ======================================================

      const repairResult =
        await repairOrderAmounts(
          order
        );

      if (
        !repairResult.success
      ) {
        return res.status(400).json({
          success: false,
          message:
            repairResult.message,
        });
      }

      // ======================================================
      // ASSIGN
      // ======================================================

      order.deliveryAgentName =
        String(
          deliveryAgentName
        ).trim();

      order.deliveryAgentPhone =
        String(
          deliveryAgentPhone
        ).trim();

      order.deliveryAgentAssigned =
        true;

      order.deliveryAgentAssignedAt =
        new Date();

      await order.save();

      return res.status(200).json({
        success: true,

        message:
          "Delivery partner assigned successfully.",

        order,
      });
    } catch (error) {
      console.error(
        "ASSIGN DELIVERY PARTNER ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          error.message ||
          "Unable to assign delivery partner.",
      });
    }
  };

// ============================================================
// REMOVE DELIVERY PARTNER
// ============================================================

const removeDeliveryAgent =
  async (
    req,
    res
  ) => {
    try {
      const order =
        await Order.findById(
          req.params.id
        );

      if (!order) {
        return res.status(404).json({
          success: false,
          message:
            "Order not found.",
        });
      }

      if (
        order.status ===
        "Delivered"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Delivery partner cannot be removed after the order is delivered.",
        });
      }

      order.deliveryAgentName =
        "";

      order.deliveryAgentPhone =
        "";

      order.deliveryAgentAssigned =
        false;

      order.deliveryAgentAssignedAt =
        null;

      await order.save();

      return res.status(200).json({
        success: true,

        message:
          "Delivery partner removed successfully.",

        order,
      });
    } catch (error) {
      console.error(
        "REMOVE DELIVERY PARTNER ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          error.message ||
          "Unable to remove delivery partner.",
      });
    }
  };

// ============================================================
// VERIFY DELIVERY OTP
// ============================================================

const verifyDeliveryOtp =
  async (
    req,
    res
  ) => {
    try {
      const {
        otp,
      } = req.body;

      // ======================================================
      // OTP VALIDATION
      // ======================================================

      if (
        !otp ||
        !/^\d{6}$/.test(
          String(otp).trim()
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "A valid 6-digit delivery OTP is required.",
        });
      }

      const enteredOtp =
        String(
          otp
        ).trim();

      // ======================================================
      // FIND ORDER
      // ======================================================

      const order =
        await Order.findById(
          req.params.id
        );

      if (!order) {
        return res.status(404).json({
          success: false,
          message:
            "Order not found.",
        });
      }

      // ======================================================
      // STATUS CHECK
      // ======================================================

      if (
        order.status !==
        "Out for Delivery"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Delivery OTP can only be verified when the order is Out for Delivery.",
        });
      }

      // ======================================================
      // ALREADY VERIFIED
      // ======================================================

      if (
        order.deliveryOtpVerified
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Delivery OTP has already been verified.",
        });
      }

      // ======================================================
      // OTP HASH CHECK
      // ======================================================

      if (
        !order.deliveryOtpHash
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Delivery OTP has not been generated for this order.",
        });
      }

      // ======================================================
      // MAX ATTEMPTS
      // ======================================================

      if (
        Number(
          order.deliveryOtpAttempts
        ) >= 5
      ) {
        return res.status(429).json({
          success: false,
          message:
            "Maximum delivery OTP attempts exceeded. Delivery verification is blocked.",
          attempts:
            order.deliveryOtpAttempts,
        });
      }

      // ======================================================
      // EXPIRY CHECK
      // ======================================================

      if (
        !order.deliveryOtpExpiresAt ||
        new Date() >
          new Date(
            order.deliveryOtpExpiresAt
          )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Delivery OTP has expired. Please generate a new delivery OTP.",
          expired:
            true,
        });
      }

      // ======================================================
      // HASH ENTERED OTP
      // ======================================================

      const enteredOtpHash =
        hashDeliveryOtp(
          enteredOtp
        );

      // ======================================================
      // WRONG OTP
      // ======================================================

      if (
        enteredOtpHash !==
        order.deliveryOtpHash
      ) {
        order.deliveryOtpAttempts =
          Number(
            order.deliveryOtpAttempts
          ) + 1;

        await order.save();

        const remainingAttempts =
          Math.max(
            0,
            5 -
              Number(
                order.deliveryOtpAttempts
              )
          );

        return res.status(400).json({
          success: false,
          message:
            remainingAttempts === 0
              ? "Incorrect OTP. Maximum attempts exceeded."
              : "Incorrect delivery OTP.",

          attempts:
            order.deliveryOtpAttempts,

          remainingAttempts,
        });
      }

      // ======================================================
      // CORRECT OTP
      // ======================================================

      order.deliveryOtpVerified =
        true;

      order.deliveryOtpAttempts =
        Number(
          order.deliveryOtpAttempts
        );

      order.status =
        "Delivered";

      await order.save();

      console.log("");
      console.log(
        "=================================================="
      );
      console.log(
        "========= DELIVERY OTP VERIFIED =================="
      );
      console.log(
        "=================================================="
      );
      console.log(
        "ORDER ID =",
        order._id
      );
      console.log(
        "STATUS =",
        order.status
      );
      console.log(
        "OTP VERIFIED =",
        order.deliveryOtpVerified
      );
      console.log(
        "=================================================="
      );

      return res.status(200).json({
        success: true,

        message:
          "Delivery OTP verified successfully. Order marked as Delivered.",

        order,
      });
    } catch (error) {
      console.error(
        "VERIFY DELIVERY OTP ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          error.message ||
          "Unable to verify delivery OTP.",
      });
    }
  };

// ============================================================
// COLLECT COD PAYMENT
// ============================================================

const collectCODPayment =
  async (
    req,
    res
  ) => {
    try {
      const authenticatedUser = await User.findById(req.user?.id);
      if (!authenticatedUser) {
        return res.status(401).json({
          success: false,
          message: "Authenticated user not found.",
        });
      }

      const order =
        await Order.findById(
          req.params.id
        );

      if (!order) {
        return res.status(404).json({
          success: false,
          message:
            "Order not found.",
        });
      }

      if (authenticatedUser.role !== "admin") {
        if (authenticatedUser.role !== "pharmacy") {
          return res.status(403).json({
            success: false,
            message: "Only the order's pharmacy or an admin can confirm COD collection.",
          });
        }
        const pharmacy = await Pharmacy.findById(order.pharmacyId);
        if (
          !pharmacy ||
          String(pharmacy.phone || "").trim() !== String(authenticatedUser.phone || "").trim()
        ) {
          return res.status(403).json({
            success: false,
            message: "This order does not belong to your pharmacy account.",
          });
        }
      }

      if (
        order.paymentMethod !==
          "COD" &&
        order.paymentMethod !==
          "Cash on Delivery"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "This order is not a COD order.",
        });
      }

      if (
        order.cashCollected ||
        order.paymentStatus ===
          "Collected"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "COD payment has already been collected.",
        });
      }

      if (
        order.status !==
          "Out for Delivery" &&
        order.status !==
          "Delivered"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "COD payment can only be collected during delivery.",
        });
      }

      if (
        order.orderType ===
          "PRESCRIPTION" &&
        (
          !order.medicines ||
          order.medicines.length === 0 ||
          Number(
            order.totalAmount
          ) <= 0
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Prescription order has not been confirmed with a final amount.",
        });
      }

      if (
        order.orderType !==
        "PRESCRIPTION"
      ) {
        const repairResult =
          await repairOrderAmounts(
            order
          );

        if (
          !repairResult.success
        ) {
          return res.status(400).json({
            success: false,
            message:
              repairResult.message,
          });
        }
      }

      const confirmedAmountPaise = Math.round(Number(order.totalAmount) * 100);
      if (!Number.isSafeInteger(confirmedAmountPaise) || confirmedAmountPaise <= 0) {
        return res.status(400).json({
          success: false,
          message: "The COD amount is invalid.",
        });
      }
      const submittedAmount = req.body?.amountPaise;
      if (
        submittedAmount !== undefined &&
        Number(submittedAmount) !== confirmedAmountPaise
      ) {
        return res.status(409).json({
          success: false,
          message: "The confirmed cash amount does not match the order total.",
          expectedAmountPaise: confirmedAmountPaise,
        });
      }

      const collectedAt = new Date();
      const collectedOrder = await Order.findOneAndUpdate(
        {
          _id: order._id,
          paymentMethod: { $in: ["COD", "Cash on Delivery"] },
          cashCollected: { $ne: true },
          paymentStatus: { $nin: ["Collected", "Paid"] },
          status: { $in: ["Out for Delivery", "Delivered"] },
        },
        {
          $set: {
            paymentStatus: "Collected",
            cashCollected: true,
            cashCollectedAt: collectedAt,
            cashCollectedBy: String(authenticatedUser._id),
            cashCollectedAmountPaise: confirmedAmountPaise,
            settlementStatus: "Pending",
          },
        },
        { new: true, runValidators: true }
      );
      if (!collectedOrder) {
        const latestOrder = await Order.findById(order._id);
        return res.status(409).json({
          success: false,
          message: latestOrder?.cashCollected
            ? "COD payment has already been collected."
            : "Order is no longer eligible for COD collection.",
        });
      }

      console.log(
        "COD PAYMENT COLLECTED"
      );

      console.log(
        "ORDER ID =",
        collectedOrder._id
      );

      console.log(
        "AMOUNT =",
        collectedOrder.totalAmount
      );

      return res.status(200).json({
        success: true,

        message:
          "COD payment marked as collected.",

        order: collectedOrder,
      });
    } catch (error) {
      console.error(
        "COLLECT COD PAYMENT ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          error.message ||
          "Unable to collect COD payment.",
      });
    }
  };

// ============================================================
// GET ALL ORDERS
// ============================================================

const getAllOrders =
  async (
    req,
    res
  ) => {
    try {
      const orders =
        await Order.find()
          .sort({
            createdAt: -1,
          });

      return res.status(200).json({
        success: true,

        total:
          orders.length,

        orders,
      });
    } catch (error) {
      console.error(
        "GET ALL ORDERS ERROR:",
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
  placeOrder,
  placePrescriptionOrder,
  confirmPrescriptionOrder,
  getPharmacyOrders,
  getPatientOrders,
  updateOrderStatus,
  assignDeliveryAgent,
  removeDeliveryAgent,
  verifyDeliveryOtp,
  getDeliveryOtp,
  collectCODPayment,
  getAllOrders,
};
