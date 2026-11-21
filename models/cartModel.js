const mongoose = require("mongoose");

const cartSchema = new mongoose.Schema(
  {
    patientPhone:{
type:String,
required:true
},

    patientName: {
      type: String,
      default: "",
    },

    familyMemberId: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },

    medicineId: {
      type: String,
      default: "",
    },

    // Source link used to show per-medicine completion on the patient's
    // prescription. Ordinary pharmacy cart items leave these fields empty.
    prescriptionId: {
      type: String,
      default: "",
    },

    prescriptionMedicineId: {
      type: String,
      default: "",
    },

    medicine: {
      type: String,
      required: true,
    },

    dose: {
      type: String,
      default: "",
    },

    duration: {
      type: String,
      default: "",
    },

    food: {
      type: String,
      default: "",
    },

    instruction: {
      type: String,
      default: "",
    },

    quantity: {
      type: Number,
      default: 1,
    },


price: {
  type: Number,
  default: 0,
},

subtotal: {
  type: Number,
  default: 0,
},

    status: {
      type: String,
      default: "Pending",
    }
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Cart", cartSchema);
