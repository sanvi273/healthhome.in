const Appointment = require("../models/Appointment");
const Order = require("../models/orderModel");
const LabOrder = require("../models/labOrder");

const BUSINESS_TIME_ZONE = "Asia/Kolkata";
const PLATFORM_FEE_PERCENTAGE = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

const getIndiaDate = (date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const getDateRange = (period, now = new Date()) => {
  const daysByPeriod = { today: 1, "7d": 7, "30d": 30 };
  const days = daysByPeriod[period];
  if (!days) return null;

  // India uses UTC+05:30 year-round. Construct midnight at the business-zone
  // boundary so daily totals do not shift with the server's configured zone.
  const indiaToday = getIndiaDate(now);
  const todayStart = new Date(`${indiaToday}T00:00:00+05:30`);
  const from = new Date(todayStart.getTime() - (days - 1) * DAY_MS);
  return { from, to: now, timezone: BUSINESS_TIME_ZONE };
};

const amountPaiseExpression = (field) => ({
  $round: [
    {
      $multiply: [
        { $convert: { input: `$${field}`, to: "double", onError: 0, onNull: 0 } },
        100,
      ],
    },
    0,
  ],
});

const lowerStatus = (field) => ({
  $toLower: { $convert: { input: `$${field}`, to: "string", onError: "", onNull: "" } },
});

const isPaidExpression = (paymentField, includeCashCollection) => includeCashCollection
  ? {
      $or: [
        { $in: [lowerStatus(paymentField), ["paid", "collected", "success"]] },
        { $eq: ["$cashCollected", true] },
      ],
    }
  : { $in: [lowerStatus(paymentField), ["paid", "success"]] };

const metricPipeline = ({
  from,
  to,
  paymentField,
  amountField,
  includeCashCollection = false,
  providerIdField,
  providerNameField,
}) => {
  const paid = isPaidExpression(paymentField, includeCashCollection);
  const amountPaise = amountPaiseExpression(amountField);
  const rangeMatch = { createdAt: { $gte: from, $lte: to } };
  const group = {
    _id: null,
    totalCount: { $sum: 1 },
    paidCount: { $sum: { $cond: [paid, 1, 0] } },
    pendingCount: {
      $sum: {
        $cond: [{ $in: [lowerStatus(paymentField), ["pending", "created"]] }, 1, 0],
      },
    },
    cancelledCount: {
      $sum: {
        $cond: [{ $in: [lowerStatus("status"), ["cancelled", "canceled", "rejected"]] }, 1, 0],
      },
    },
    grossCollectedPaise: { $sum: { $cond: [paid, amountPaise, 0] } },
  };

  const providerGroup = {
    _id: { $ifNull: [`$${providerIdField}`, ""] },
    providerName: {
      $first: {
        $let: {
          vars: { name: { $ifNull: [`$${providerNameField}`, ""] } },
          in: { $cond: [{ $eq: ["$$name", ""] }, "Unassigned provider", "$$name"] },
        },
      },
    },
    bookingCount: { $sum: 1 },
    paidCount: { $sum: { $cond: [paid, 1, 0] } },
    grossCollectedPaise: { $sum: { $cond: [paid, amountPaise, 0] } },
  };

  return [
    { $match: rangeMatch },
    {
      $facet: {
        totals: [{ $group: group }],
        providers: [
          { $group: providerGroup },
          { $sort: { grossCollectedPaise: -1, bookingCount: -1, providerName: 1 } },
          { $limit: 100 },
        ],
      },
    },
  ];
};

const toMoney = (paise) => Number((Number(paise || 0) / 100).toFixed(2));

const formatAggregate = (result, providerType) => {
  const totals = result?.totals?.[0] || {};
  const grossCollectedPaise = Number(totals.grossCollectedPaise || 0);
  const platformFeePaise = Math.round(grossCollectedPaise * PLATFORM_FEE_PERCENTAGE / 100);

  return {
    providerType,
    totalCount: Number(totals.totalCount || 0),
    paidCount: Number(totals.paidCount || 0),
    pendingPaymentCount: Number(totals.pendingCount || 0),
    cancelledCount: Number(totals.cancelledCount || 0),
    grossCollected: toMoney(grossCollectedPaise),
    platformFeeEstimate: toMoney(platformFeePaise),
    providerPayableEstimate: toMoney(grossCollectedPaise - platformFeePaise),
    providers: (result?.providers || []).map((provider) => {
      const gross = Number(provider.grossCollectedPaise || 0);
      const fee = Math.round(gross * PLATFORM_FEE_PERCENTAGE / 100);
      return {
        providerId: String(provider._id || ""),
        providerName: String(provider.providerName || "Unassigned provider"),
        bookingCount: Number(provider.bookingCount || 0),
        paidCount: Number(provider.paidCount || 0),
        grossCollected: toMoney(gross),
        platformFeeEstimate: toMoney(fee),
        providerPayableEstimate: toMoney(gross - fee),
      };
    }),
  };
};

exports.getAdminAnalytics = async (req, res) => {
  try {
    const period = String(req.query.period || "today").toLowerCase();
    const range = getDateRange(period);
    if (!range) {
      return res.status(400).json({
        success: false,
        message: "period must be today, 7d, or 30d.",
      });
    }

    const [appointments, medicineOrders, labBookings] = await Promise.all([
      Appointment.aggregate(metricPipeline({
        ...range,
        paymentField: "paymentStatus",
        amountField: "fees",
        providerIdField: "doctorId",
        providerNameField: "doctorName",
      })),
      Order.aggregate(metricPipeline({
        ...range,
        paymentField: "paymentStatus",
        amountField: "totalAmount",
        includeCashCollection: true,
        providerIdField: "pharmacyId",
        providerNameField: "pharmacyName",
      })),
      LabOrder.aggregate(metricPipeline({
        ...range,
        paymentField: "paymentStatus",
        amountField: "totalAmount",
        providerIdField: "labId",
        providerNameField: "labName",
      })),
    ]);

    const services = {
      doctor: formatAggregate(appointments[0], "Doctor"),
      medicine: formatAggregate(medicineOrders[0], "Pharmacy"),
      laboratory: formatAggregate(labBookings[0], "Laboratory"),
    };
    const totalCount = services.doctor.totalCount + services.medicine.totalCount + services.laboratory.totalCount;
    const paidCount = services.doctor.paidCount + services.medicine.paidCount + services.laboratory.paidCount;
    const grossCollected = services.doctor.grossCollected + services.medicine.grossCollected + services.laboratory.grossCollected;
    const platformFeeEstimate = services.doctor.platformFeeEstimate + services.medicine.platformFeeEstimate + services.laboratory.platformFeeEstimate;
    const providerPayableEstimate = services.doctor.providerPayableEstimate + services.medicine.providerPayableEstimate + services.laboratory.providerPayableEstimate;

    return res.status(200).json({
      success: true,
      period,
      timezone: range.timezone,
      dateBasis: "service_created_at",
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      feePercentage: PLATFORM_FEE_PERCENTAGE,
      estimatesOnly: true,
      totals: {
        totalServiceRecords: totalCount,
        paidServiceRecords: paidCount,
        grossCollected: Number(grossCollected.toFixed(2)),
        platformFeeEstimate: Number(platformFeeEstimate.toFixed(2)),
        providerPayableEstimate: Number(providerPayableEstimate.toFixed(2)),
      },
      services,
    });
  } catch (error) {
    console.error("ADMIN ANALYTICS ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load admin analytics.",
    });
  }
};

exports._test = { getDateRange, formatAggregate, metricPipeline };
