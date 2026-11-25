const mongoose = require("mongoose");
const Appointment = require("../models/Appointment");
const Doctor = require("../models/doctor");
const Lab = require("../models/lab");
const LabOrder = require("../models/labOrder");
const Order = require("../models/orderModel");
const Pharmacy = require("../models/pharmacy");
const Rating = require("../models/Rating");
const User = require("../models/user");

const entityTypes = {
  doctor: { role: "doctor", Model: Doctor },
  laboratory: { role: "laboratory", Model: Lab },
  pharmacy: { role: "pharmacy", Model: Pharmacy },
};

const targetIdForUser = async (entityType, user) => {
  const config = entityTypes[entityType];
  if (!config) return null;
  const ownership = [{ userId: user._id }];
  if (user.phone) {
    ownership.push(
      { userId: null, phone: user.phone },
      { userId: { $exists: false }, phone: user.phone },
    );
  }
  const profile = await config.Model.findOne({ $or: ownership })
    .select("_id").lean();
  return profile?._id ? String(profile._id) : null;
};

const getRatingSummary = async (entityType, targetId) => {
  const [summary] = await Rating.aggregate([
    { $match: { entityType, targetId } },
    {
      $group: {
        _id: null,
        average: { $avg: "$rating" },
        count: { $sum: 1 },
      },
    },
  ]);
  return {
    rating: summary ? Number(summary.average.toFixed(1)) : 0,
    ratingCount: summary?.count || 0,
  };
};

const verifiedPatientForRequest = async (req, res) => {
  if (!req.user?.id || !mongoose.Types.ObjectId.isValid(req.user.id)) {
    res.status(401).json({ success: false, message: "Authentication required." });
    return null;
  }
  const user = await User.findById(req.user.id).select("name phone role");
  if (!user || user.role !== "patient") {
    res.status(403).json({ success: false, message: "Patient account required." });
    return null;
  }
  return user;
};

const patientPhoneVariants = (user) => {
  const raw = String(user.phone || "").trim();
  const digits = raw.replace(/\D/g, "");
  const variants = new Set([raw, digits].filter(Boolean));
  if (digits.length === 10) variants.add(`91${digits}`);
  if (digits.length === 12 && digits.startsWith("91")) variants.add(digits.slice(2));
  return [...variants];
};

const orderPatientFilter = (user) => {
  const phones = patientPhoneVariants(user);
  const alternatives = [{ patientId: String(user._id) }];
  if (phones.length) {
    alternatives.push({ patientId: { $in: phones } });
    alternatives.push({ patientPhone: { $in: phones } });
  }
  return { $or: alternatives };
};

const appointmentPatientFilter = (user) => {
  const alternatives = [{ patientId: user._id }];
  if (user.phone) alternatives.push({ patientPhone: user.phone });
  return { $or: alternatives };
};

const getEligibleTransactions = async (user) => {
  const id = String(user._id);
  const orderIdentityFilter = orderPatientFilter(user);
  const [appointments, labOrders, pharmacyOrders, existingRatings] = await Promise.all([
    Appointment.find({ status: "Completed", ...appointmentPatientFilter(user) })
      .select("_id doctorId doctorName appointmentDate createdAt")
      .sort({ createdAt: -1 }).lean(),
    LabOrder.find({ patientId: id, status: "Completed" })
      .select("_id labId labName createdAt")
      .sort({ createdAt: -1 }).lean(),
    Order.find({ status: "Delivered", ...orderIdentityFilter })
      .select("_id pharmacyId pharmacyName deliveredAt createdAt")
      .sort({ createdAt: -1 }).lean(),
    Rating.find({ patientId: user._id }).select("entityType transactionId rating review createdAt").lean(),
  ]);

  const ratingsByTransaction = new Map(
    existingRatings.map((rating) => [`${rating.entityType}:${rating.transactionId}`, rating]),
  );
  const toItem = (entityType, transaction, targetId, providerName, date) => {
    const prior = ratingsByTransaction.get(`${entityType}:${String(transaction._id)}`);
    return {
      entityType,
      transactionId: String(transaction._id),
      targetId: String(targetId || ""),
      providerName: providerName || "Healthcare provider",
      serviceDate: date || transaction.createdAt,
      rating: prior?.rating || null,
      review: prior?.review || "",
      reviewed: Boolean(prior),
    };
  };

  return [
    ...appointments.map((item) => toItem("doctor", item, item.doctorId, item.doctorName, item.appointmentDate || item.createdAt)),
    ...labOrders.map((item) => toItem("laboratory", item, item.labId, item.labName, item.createdAt)),
    ...pharmacyOrders.map((item) => toItem("pharmacy", item, item.pharmacyId, item.pharmacyName, item.deliveredAt || item.createdAt)),
  ].filter((item) => item.targetId);
};

const getEligibleReviews = async (req, res) => {
  try {
    const user = await verifiedPatientForRequest(req, res);
    if (!user) return;
    return res.status(200).json({
      success: true,
      reviews: await getEligibleTransactions(user),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const findCompletedTransaction = async (user, entityType, targetId, transactionId) => {
  if (entityType === "doctor") {
    return Appointment.findOne({
      _id: transactionId,
      doctorId: targetId,
      status: "Completed",
      ...appointmentPatientFilter(user),
    }).select("doctorName").lean();
  }
  if (entityType === "laboratory") {
    return LabOrder.findOne({
      _id: transactionId,
      patientId: String(user._id),
      labId: targetId,
      status: "Completed",
    }).select("labName").lean();
  }
  if (entityType === "pharmacy") {
    return Order.findOne({
      _id: transactionId,
      pharmacyId: targetId,
      status: "Delivered",
      ...orderPatientFilter(user),
    }).select("pharmacyName").lean();
  }
  return null;
};

const createRating = async (req, res) => {
  try {
    const user = await verifiedPatientForRequest(req, res);
    if (!user) return;

    const entityType = String(req.body.entityType || "").trim().toLowerCase();
    const targetId = String(req.body.targetId || "").trim();
    const transactionId = String(req.body.transactionId || "").trim();
    const rating = Number(req.body.rating);
    const review = String(req.body.review || "").trim();

    if (!entityTypes[entityType] || !mongoose.Types.ObjectId.isValid(targetId) ||
        !mongoose.Types.ObjectId.isValid(transactionId) || !Number.isInteger(rating) ||
        rating < 1 || rating > 5 || review.length > 600) {
      return res.status(400).json({ success: false, message: "Enter a valid 1 to 5 star rating and review." });
    }

    const transaction = await findCompletedTransaction(user, entityType, targetId, transactionId);
    if (!transaction) {
      return res.status(403).json({ success: false, message: "Only patients with a completed service can review this provider." });
    }

    const providerName = transaction.doctorName || transaction.labName || transaction.pharmacyName || "Healthcare provider";
    const saved = await Rating.create({
      entityType,
      targetId,
      transactionId,
      patientId: user._id,
      providerName,
      rating,
      review,
    });
    const summary = await getRatingSummary(entityType, targetId);
    return res.status(201).json({ success: true, rating: saved, summary });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "This completed service has already been reviewed." });
    }
    if (error.name === "CastError") {
      return res.status(400).json({ success: false, message: "Invalid service or provider ID." });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getPublicReviews = async (req, res) => {
  try {
    const entityType = String(req.params.entityType || "").trim().toLowerCase();
    const targetId = String(req.params.targetId || "").trim();
    if (!entityTypes[entityType] || !mongoose.Types.ObjectId.isValid(targetId)) {
      return res.status(400).json({ success: false, message: "Invalid provider." });
    }
    const [summary, reviews] = await Promise.all([
      getRatingSummary(entityType, targetId),
      Rating.find({ entityType, targetId })
        .select("rating review createdAt")
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
    ]);
    return res.status(200).json({
      success: true,
      summary,
      reviews: reviews.map((item) => ({
        rating: item.rating,
        review: item.review,
        createdAt: item.createdAt,
        reviewer: "Verified patient",
      })),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getProviderReviews = async (req, res) => {
  try {
    const user = await User.findById(req.user?.id).select("name phone role");
    const entityType = user?.role;
    if (!user || !entityTypes[entityType]) {
      return res.status(403).json({ success: false, message: "Provider account required." });
    }
    const targetId = await targetIdForUser(entityType, user);
    if (!targetId) {
      return res.status(404).json({ success: false, message: "Provider profile not found." });
    }
    const [summary, reviews] = await Promise.all([
      getRatingSummary(entityType, targetId),
      Rating.find({ entityType, targetId })
        .select("rating review providerName createdAt")
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
    ]);
    return res.status(200).json({
      success: true,
      entityType,
      targetId,
      summary,
      reviews: reviews.map((item) => ({
        rating: item.rating,
        review: item.review,
        providerName: item.providerName,
        createdAt: item.createdAt,
        reviewer: "Verified patient",
      })),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { createRating, getEligibleReviews, getPublicReviews, getProviderReviews };
