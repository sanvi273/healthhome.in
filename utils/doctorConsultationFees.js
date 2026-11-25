const getDoctorConsultationFee = (doctor, consultationType) => {
  const feeField =
    String(consultationType || "").trim().toLowerCase() === "video consultation"
      ? "videoConsultationFee"
      : "hospitalVisitFee";
  const specificFee = doctor?.[feeField];
  const rawFee =
    specificFee === undefined || specificFee === null || String(specificFee).trim() === ""
      ? doctor?.fees
      : specificFee;
  const amount = Number(rawFee);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
};

module.exports = { getDoctorConsultationFee };
