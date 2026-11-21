const mongoose = require("mongoose");
const LabTestCart = require("../models/labTestCartModel");
const Lab = require("../models/lab");
const User = require("../models/user");

const requirePatient = async (req, res) => {
  if (req.user?.role !== "patient") {
    res.status(403).json({
      success: false,
      message: "Only patient accounts can manage a lab test cart.",
    });
    return null;
  }

  const patient = await User.findById(req.user.id).select("name phone role");
  if (!patient || patient.role !== "patient") {
    res.status(404).json({
      success: false,
      message: "Patient account was not found.",
    });
    return null;
  }
  return patient;
};

exports.getLabTestCart = async (req, res) => {
  try {
    const patient = await requirePatient(req, res);
    if (!patient) return;

    const items = await LabTestCart.find({ patientId: patient._id })
      .sort({ createdAt: -1 })
      .lean();
    return res.status(200).json({ success: true, items });
  } catch (error) {
    console.error("GET LAB TEST CART FAILED", error.name || "DatabaseError");
    return res.status(500).json({
      success: false,
      message: "Unable to load your lab test cart.",
    });
  }
};

exports.addLabTestToCart = async (req, res) => {
  try {
    const patient = await requirePatient(req, res);
    if (!patient) return;

    const labId = String(req.body?.labId || "").trim();
    const testId = String(req.body?.testId || "").trim();
    if (
      !mongoose.Types.ObjectId.isValid(labId) ||
      !mongoose.Types.ObjectId.isValid(testId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Choose a valid laboratory test.",
      });
    }

    const lab = await Lab.findById(labId);
    if (!lab) {
      return res.status(404).json({
        success: false,
        message: "The laboratory is no longer available.",
      });
    }

    const test = lab.tests.id(testId);
    if (!test || test.isActive === false) {
      return res.status(404).json({
        success: false,
        message: "This laboratory test is no longer available.",
      });
    }

    const item = await LabTestCart.findOneAndUpdate(
      { patientId: patient._id, labId: String(lab._id), testId: String(test._id) },
      {
        $set: {
          patientPhone: patient.phone || "",
          labName: lab.name,
          testName: test.testName,
          category: test.category || "General",
          price: Number(test.price) || 0,
          sampleType: test.sampleType || "Blood",
          reportTime: test.reportTime || "24 Hours",
        },
        $setOnInsert: {
          patientId: patient._id,
          labId: String(lab._id),
          testId: String(test._id),
        },
      },
      { new: true, upsert: true, runValidators: true },
    );

    return res.status(200).json({
      success: true,
      message: "Lab test added to your cart.",
      item,
    });
  } catch (error) {
    console.error("ADD LAB TEST TO CART FAILED", error.name || "DatabaseError");
    return res.status(500).json({
      success: false,
      message: "Unable to add this test to your cart.",
    });
  }
};

exports.removeLabTestFromCart = async (req, res) => {
  try {
    const patient = await requirePatient(req, res);
    if (!patient) return;

    const item = await LabTestCart.findOneAndDelete({
      _id: req.params.id,
      patientId: patient._id,
    });
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "This lab test is not in your cart.",
      });
    }
    return res.status(200).json({
      success: true,
      message: "Lab test removed from your cart.",
    });
  } catch (error) {
    console.error("REMOVE LAB TEST CART ITEM FAILED", error.name || "DatabaseError");
    return res.status(500).json({
      success: false,
      message: "Unable to remove this test from your cart.",
    });
  }
};
