console.log("THIS IS MY REAL SERVER");

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

// ============================================================
// IMPORT ROUTES
// ============================================================

const authRoutes = require("./routes/authRoutes");
const doctorRoutes = require("./routes/doctorRoutes");
const labRoutes = require("./routes/labRoutes");
const pharmacyRoutes = require("./routes/pharmacyRoutes");
const appointmentRoutes = require("./routes/appointmentRoutes");
const addressRoutes = require("./routes/addressRoutes");
const profileRoutes = require("./routes/profileRoutes");
const medicineRoutes = require("./routes/medicineRoutes");
const orderRoutes = require("./routes/orderRoutes");
const cartRoutes = require("./routes/cartRoutes");
const labOrderRoutes = require("./routes/labOrderRoutes");
const sampleCollectorRoutes = require("./routes/sampleCollectorRoutes");
const prescriptionRoutes = require("./routes/prescriptionRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const verificationRoutes = require("./routes/verificationRoutes");

// ============================================================
// APP
// ============================================================

const app = express();

// ============================================================
// CORS
// ============================================================

app.use(cors());

// ============================================================
// RAZORPAY WEBHOOK RAW BODY
// ============================================================
//
// IMPORTANT:
//
// Razorpay webhook signature verification needs the ORIGINAL
// raw request body.
//
// Therefore this MUST be registered before express.json().
//
// URL:
// POST /api/payment/webhook
//
// ============================================================

app.use(
  "/api/payment/webhook",
  express.raw({
    type: "application/json",
  })
);

// ============================================================
// NORMAL BODY PARSERS
// ============================================================

app.use(express.json());

app.use(
  express.urlencoded({
    extended: true,
  })
);

// ============================================================
// AUTH ROUTES
// ============================================================

app.use(
  "/api/auth",
  authRoutes
);

// ============================================================
// DOCTOR ROUTES
// ============================================================

app.use(
  "/api/doctors",
  doctorRoutes
);

// ============================================================
// LAB ROUTES
// ============================================================

app.use(
  "/api/labs",
  labRoutes
);

// ============================================================
// PHARMACY ROUTES
// ============================================================

app.use(
  "/api/pharmacies",
  pharmacyRoutes
);

// ============================================================
// APPOINTMENT ROUTES
// ============================================================

app.use(
  "/api/appointments",
  appointmentRoutes
);

// ============================================================
// ADDRESS ROUTES
// ============================================================

app.use(
  "/api/addresses",
  addressRoutes
);

// ============================================================
// PROFILE ROUTES
// ============================================================

app.use(
  "/api/profile",
  profileRoutes
);

// ============================================================
// MEDICINE ROUTES
// ============================================================

app.use(
  "/api/medicines",
  medicineRoutes
);

// ============================================================
// ORDER ROUTES
// ============================================================

app.use(
  "/api/orders",
  orderRoutes
);

// ============================================================
// CART ROUTES
// ============================================================

app.use(
  "/api/cart",
  cartRoutes
);

console.log("Cart Routes Loaded Successfully");

// ============================================================
// LAB ORDER ROUTES
// ============================================================

app.use(
  "/api/lab-orders",
  labOrderRoutes
);

// ============================================================
// SAMPLE COLLECTOR ROUTES
// ============================================================

app.use(
  "/api/sample-collectors",
  sampleCollectorRoutes
);

// ============================================================
// PRESCRIPTION ROUTES
// ============================================================

console.log("Mounting prescription routes...");

app.use(
  "/api/prescriptions",
  prescriptionRoutes
);

console.log("Prescription routes mounted.");

// ============================================================
// PAYMENT ROUTES
// ============================================================

console.log("Mounting payment routes...");

app.use(
  "/api/payment",
  paymentRoutes
);

console.log("Payment routes mounted.");

// ============================================================
// VERIFICATION ROUTES
// ============================================================

app.use(
  "/api/verification",
  verificationRoutes
);

console.log("Verification routes mounted.");


 // ============================================================
 // TEST ROUTES
 // ============================================================

 app.get("/", (req, res) => {
   res.send("HealthHome Backend Running");
 });

 app.get("/test-doctor-route", (req, res) => {
   res.json({
     success: true,
     message: "Updated server.js is deployed"
   });
 });


// ============================================================
// MONGODB
// ============================================================

mongoose
  .connect(process.env.MONGO_URL)
  .then(() => {
    console.log("✅ MongoDB Connected");
  })
  .catch((err) => {
    console.log("❌ MongoDB Error:", err);
  });

// ============================================================
// SERVER
// ============================================================

const PORT = process.env.PORT || 5000;

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `🚀 Server running on port ${PORT}`
    );
  }

  
);