const Appointment = require("../models/Appointment");
const LabOrder = require("../models/labOrder");
const Order = require("../models/orderModel");

const TIME_ZONE = "Asia/Kolkata";
const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 330 * 60 * 1000;
const FEE_PERCENTAGE = Number.isFinite(Number(process.env.PLATFORM_FEE_PERCENT))
  ? Math.min(100, Math.max(0, Number(process.env.PLATFORM_FEE_PERCENT)))
  : 5;

const getDateRange = (period, now = new Date()) => {
  const dayCount = { today: 1, "7d": 7, "30d": 30 }[period];
  if (!dayCount) return null;

  // Build the beginning of the current calendar day in the dashboard's
  // configured timezone, then include the selected number of calendar days.
  const localNow = new Date(now.getTime() + IST_OFFSET_MS);
  const localMidnightUtc = Date.UTC(
    localNow.getUTCFullYear(),
    localNow.getUTCMonth(),
    localNow.getUTCDate()
  );
  const end = localMidnightUtc - IST_OFFSET_MS + DAY_MS;
  const start = end - dayCount * DAY_MS;
  return { start: new Date(start), end: new Date(Math.min(end, now.getTime() + 1)) };
};

const amountOf = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

const normalized = (value) => String(value ?? "").trim().toLowerCase();

const isPaidOrCollected = (record, service) => {
  const state = normalized(record.paymentStatus);
  if (["paid", "success", "collected"].includes(state)) return true;
  if (service === "medicine" && record.cashCollected === true) return true;
  return false;
};

const providerDetails = (record, service) => {
  if (service === "doctor") {
    return {
      id: String(record.doctorId ?? "").trim(),
      name: String(record.doctorName ?? "").trim(),
    };
  }
  if (service === "laboratory") {
    return {
      id: String(record.labId ?? "").trim(),
      name: String(record.labName ?? "").trim(),
    };
  }
  return {
    id: String(record.pharmacyId ?? "").trim(),
    name: String(record.pharmacyName ?? "").trim(),
  };
};

const summarizeService = (records, service) => {
  const providers = new Map();
  let paidCount = 0;
  let grossCollected = 0;

  for (const record of records) {
    const paid = isPaidOrCollected(record, service);
    const amount = paid
      ? amountOf(service === "doctor" ? record.fees : record.totalAmount)
      : 0;
    if (paid) {
      paidCount += 1;
      grossCollected += amount;
    }

    const { id, name } = providerDetails(record, service);
    const providerKey = id || name || "unknown";
    const provider = providers.get(providerKey) ?? {
      providerId: id,
      providerName: name || (id ? `Provider ${id}` : "Provider"),
      bookingCount: 0,
      paidCount: 0,
      providerPayableEstimate: 0,
    };
    provider.bookingCount += 1;
    if (paid) {
      provider.paidCount += 1;
      const savedPayable = Number(record.providerAmount);
      const savedFee = Number(record.platformFee);
      const hasSavedBreakdown = Number.isFinite(savedPayable) && savedPayable >= 0 &&
        Number.isFinite(savedFee) && savedFee > 0;
      provider.providerPayableEstimate += hasSavedBreakdown
        ? savedPayable
        : amount * (1 - FEE_PERCENTAGE / 100);
    }
    providers.set(providerKey, provider);
  }

  const platformFeeEstimate = grossCollected * FEE_PERCENTAGE / 100;
  return {
    totalCount: records.length,
    paidCount,
    grossCollected: Number(grossCollected.toFixed(2)),
    platformFeeEstimate: Number(platformFeeEstimate.toFixed(2)),
    providerPayableEstimate: Number((grossCollected - platformFeeEstimate).toFixed(2)),
    providers: [...providers.values()]
      .map((provider) => ({
        ...provider,
        providerPayableEstimate: Number(provider.providerPayableEstimate.toFixed(2)),
      }))
      .sort((left, right) => right.bookingCount - left.bookingCount ||
        left.providerName.localeCompare(right.providerName)),
  };
};

const getAdminAnalytics = async (req, res) => {
  try {
    const period = String(req.query.period ?? "today").trim().toLowerCase();
    const range = getDateRange(period);
    if (!range) {
      return res.status(400).json({
        success: false,
        message: "period must be one of today, 7d, or 30d.",
      });
    }

    const filter = { createdAt: { $gte: range.start, $lt: range.end } };
    const [appointments, medicineOrders, labOrders] = await Promise.all([
      Appointment.find(filter).lean(),
      Order.find(filter).lean(),
      LabOrder.find(filter).lean(),
    ]);

    const services = {
      doctor: summarizeService(appointments, "doctor"),
      medicine: summarizeService(medicineOrders, "medicine"),
      laboratory: summarizeService(labOrders, "laboratory"),
    };
    const totals = Object.values(services).reduce(
      (sum, service) => ({
        totalServiceRecords: sum.totalServiceRecords + service.totalCount,
        paidServiceRecords: sum.paidServiceRecords + service.paidCount,
        grossCollected: sum.grossCollected + service.grossCollected,
      }),
      { totalServiceRecords: 0, paidServiceRecords: 0, grossCollected: 0 }
    );
    const platformFeeEstimate = totals.grossCollected * FEE_PERCENTAGE / 100;

    return res.status(200).json({
      success: true,
      period,
      timezone: TIME_ZONE,
      range: { start: range.start, end: range.end },
      feePercentage: FEE_PERCENTAGE,
      totals: {
        ...totals,
        grossCollected: Number(totals.grossCollected.toFixed(2)),
        platformFeeEstimate: Number(platformFeeEstimate.toFixed(2)),
        providerPayableEstimate: Number((totals.grossCollected - platformFeeEstimate).toFixed(2)),
      },
      services,
    });
  } catch (error) {
    console.error("ADMIN ANALYTICS ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load business analytics.",
    });
  }
};

module.exports = { getAdminAnalytics, getDateRange, summarizeService };
