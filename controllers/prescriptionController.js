console.log("🔥 CONTROLLER LOADED");

const PDFDocument = require("pdfkit");
const path = require("path");
const fs = require("fs");

const Prescription = require("../models/prescriptionModel");
const Appointment = require("../models/Appointment");

console.log("===== PRESCRIPTION SCHEMA =====");
console.log(Prescription.schema.obj);
console.log("===============================");


// ============================================================
// HEALTHHOME PDF BRANDING
// ============================================================

const HEALTHHOME = {
  primary: "#00C2CB",
  primaryDark: "#00AEB8",
  dark: "#123B40",
  text: "#111111",
  gray: "#667085",
  light: "#F0FAFA",
  border: "#D9E2E5",
  white: "#FFFFFF",
};


// ============================================================
// LOGO PATH
// ============================================================

const logoPath = path.join(
  __dirname,
  "../assets/logo.png"
);

console.log(
  "HealthHome Logo Path:",
  logoPath
);

console.log(
  "HealthHome Logo Exists:",
  fs.existsSync(logoPath)
);


// ============================================================
// HEALTHHOME HEADER
// ============================================================

function addHealthHomeHeader(doc) {
  const pageWidth = doc.page.width;

  doc.save();

  // Header background
  doc
    .rect(
      0,
      0,
      pageWidth,
      82
    )
    .fill(
      HEALTHHOME.light
    );

  // ----------------------------------------------------------
  // REAL HEALTHHOME LOGO
  // ----------------------------------------------------------

  if (fs.existsSync(logoPath)) {
    try {
      doc.image(
        logoPath,
        45,
        17,
        {
          fit: [58, 58],
          align: "left",
          valign: "center",
        }
      );
    } catch (error) {
      console.error(
        "Logo rendering error:",
        error
      );
    }
  }

  // ----------------------------------------------------------
  // HEALTHHOME NAME
  // ----------------------------------------------------------

  doc
    .fillColor(
      HEALTHHOME.dark
    )
    .font("Helvetica-Bold")
    .fontSize(21)
    .text(
      "HealthHome.in",
      110,
      18,
      {
        width: 220,
        lineBreak: false,
      }
    );

  // ----------------------------------------------------------
  // TAGLINE
  // ----------------------------------------------------------

  doc
    .fillColor(
      HEALTHHOME.gray
    )
    .font("Helvetica")
    .fontSize(8.5)
    .text(
      "Your Complete Digital Healthcare Platform",
      106,
      45,
      {
        width: 250,
        lineBreak: false,
      }
    );

  // ----------------------------------------------------------
  // RIGHT SIDE LABEL
  // ----------------------------------------------------------

  doc
    .fillColor(
      HEALTHHOME.primaryDark
    )
    .font("Helvetica-Bold")
    .fontSize(8)
    .text(
      "DIGITAL HEALTHCARE",
      pageWidth - 180,
      29,
      {
        width: 135,
        align: "right",
        lineBreak: false,
      }
    );

  // ----------------------------------------------------------
  // HEADER LINE
  // ----------------------------------------------------------

  doc
    .moveTo(
      45,
      82
    )
    .lineTo(
      pageWidth - 45,
      82
    )
    .lineWidth(1)
    .strokeColor(
      HEALTHHOME.primary
    )
    .stroke();

  doc.restore();
}


// ============================================================
// HEALTHHOME FOOTER
// ============================================================

function addHealthHomeFooter(doc) {

  const pageWidth =
    doc.page.width;

  const pageHeight =
    doc.page.height;

  doc.save();

  // ----------------------------------------------------------
  // FOOTER LINE
  // ----------------------------------------------------------

  doc
    .moveTo(
      45,
      pageHeight - 42
    )
    .lineTo(
      pageWidth - 45,
      pageHeight - 42
    )
    .lineWidth(0.6)
    .strokeColor(
      HEALTHHOME.border
    )
    .stroke();

  // ----------------------------------------------------------
  // LEFT FOOTER
  // ----------------------------------------------------------

  doc
    .fillColor(
      HEALTHHOME.gray
    )
    .font("Helvetica")
    .fontSize(8)
    .text(
      "Powered by HealthHome.in",
      45,
      pageHeight - 30,
      {
        width: 200,
        height: 12,
        align: "left",
        lineBreak: false,
      }
    );

  // ----------------------------------------------------------
  // RIGHT FOOTER
  // ----------------------------------------------------------

  doc
    .fillColor(
      HEALTHHOME.gray
    )
    .font("Helvetica")
    .fontSize(8)
    .text(
      "Digital Healthcare",
      pageWidth - 150,
      pageHeight - 30,
      {
        width: 105,
        height: 12,
        align: "right",
        lineBreak: false,
      }
    );

  doc.restore();
}
// ============================================================
// HEALTHHOME ADVERTISEMENT
// ============================================================

function addHealthHomeAdvertisement(doc) {
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;

  const x = 45;
  const width = pageWidth - 90;

  const height = 75;

  // Advertisement position
  const y =
    pageHeight - 135;

  doc.save();

  // ----------------------------------------------------------
  // BACKGROUND
  // ----------------------------------------------------------

  doc
    .roundedRect(
      x,
      y,
      width,
      height,
      10
    )
    .fill(
      HEALTHHOME.light
    );

  // ----------------------------------------------------------
  // LEFT ACCENT
  // ----------------------------------------------------------

  doc
    .roundedRect(
      x,
      y,
      6,
      height,
      3
    )
    .fill(
      HEALTHHOME.primary
    );

  // ----------------------------------------------------------
  // TITLE
  // ----------------------------------------------------------

  doc
    .fillColor(
      HEALTHHOME.dark
    )
    .font("Helvetica-Bold")
    .fontSize(14)
    .text(
      "HealthHome.in",
      x + 20,
      y + 10,
      {
        width: 150,
        lineBreak: false,
      }
    );

  // ----------------------------------------------------------
  // TAGLINE
  // ----------------------------------------------------------

  doc
    .fillColor("#344054")
    .font("Helvetica-Bold")
    .fontSize(9)
    .text(
      "Your Complete Digital Healthcare Platform",
      x + 20,
      y + 30,
      {
        width: width - 40,
        lineBreak: false,
      }
    );

  // ----------------------------------------------------------
  // SERVICES
  // ----------------------------------------------------------

  doc
    .fillColor(
      HEALTHHOME.gray
    )
    .font("Helvetica")
    .fontSize(8)
    .text(
      "Book Doctors  •  Order Medicines  •  Book Lab Tests  •  Access Reports",
      x + 20,
      y + 45,
      {
        width: width - 40,
        lineBreak: false,
      }
    );

  // ----------------------------------------------------------
  // FINAL MESSAGE
  // ----------------------------------------------------------

  doc
    .fillColor(
      HEALTHHOME.primaryDark
    )
    .font("Helvetica-Bold")
    .fontSize(8.5)
    .text(
      "Healthcare, simplified.   |   HealthHome.in",
      x + 20,
      y + 60,
      {
        width: width - 40,
        lineBreak: false,
      }
    );

  doc.restore();
}


// ============================================================
// SAVE PRESCRIPTION
// ============================================================

const savePrescription = async (
  req,
  res
) => {
  try {

    console.log(
      "================================"
    );

    console.log(
      "SAVE PRESCRIPTION REQUEST"
    );

    console.log(
      "BODY:",
      req.body
    );

    console.log(
      "LAB TESTS RAW:",
      req.body.labTests
    );

    console.log(
      "LAB TESTS TYPE:",
      typeof req.body.labTests
    );

    console.log(
      "================================"
    );


    // --------------------------------------------------------
    // COPY REQUEST
    // --------------------------------------------------------

    const data = {
      ...req.body,
    };


    // --------------------------------------------------------
    // LAB TESTS
    // --------------------------------------------------------

    let labTests =
      req.body.labTests;


    if (
      typeof labTests ===
      "string"
    ) {

      try {

        labTests =
          JSON.parse(
            labTests
          );

      } catch (error) {

        return res
          .status(400)
          .json({
            success: false,
            message:
              "Invalid labTests JSON format.",
          });

      }
    }


    if (
      !Array.isArray(
        labTests
      )
    ) {
      labTests = [];
    }


    data.labTests =
      labTests.map(
        (test) => {

          if (
            typeof test ===
            "string"
          ) {

            return {
              testName: test,
              priority:
                "Normal",
              note: "",
            };
          }


          return {
            testName:
              test.testName
                ?.toString() ??
              "",

            priority:
              test.priority
                ?.toString() ??
              "Normal",

            note:
              test.note
                ?.toString() ??
              "",
          };
        }
      );


    // --------------------------------------------------------
    // MEDICINES
    // --------------------------------------------------------

    let medicines =
      req.body.medicines;


    if (
      typeof medicines ===
      "string"
    ) {

      try {

        medicines =
          JSON.parse(
            medicines
          );

      } catch (error) {

        return res
          .status(400)
          .json({
            success: false,
            message:
              "Invalid medicines JSON format.",
          });

      }
    }


    if (
      !Array.isArray(
        medicines
      )
    ) {
      medicines = [];
    }


    data.medicines =
      medicines.map(
        (medicine) => {

          return {

            medicineId:
              medicine.medicineId
                ?.toString() ??
              "",

            medicine:
              medicine.medicine
                ?.toString() ??
              "",

            price:
              medicine.price
                ?.toString() ??
              "",

            dose:
              medicine.dose
                ?.toString() ??
              "",

            duration:
              medicine.duration
                ?.toString() ??
              "",

            food:
              medicine.food
                ?.toString() ??
              "",

            instruction:
              medicine.instruction
                ?.toString() ??
              "",

            morning:
              medicine.morning ===
              true,

            afternoon:
              medicine.afternoon ===
              true,

            night:
              medicine.night ===
              true,
          };
        }
      );


    // --------------------------------------------------------
    // DEBUG
    // --------------------------------------------------------

    console.log(
      "NORMALIZED LAB TESTS:",
      data.labTests
    );

    console.log(
      "NORMALIZED MEDICINES:",
      data.medicines
    );


    // --------------------------------------------------------
    // SAVE
    // --------------------------------------------------------

    const prescription =
      await Prescription.create(
        data
      );


    // --------------------------------------------------------
    // RESPONSE
    // --------------------------------------------------------

    res
      .status(201)
      .json({

        success: true,

        message:
          "Prescription Saved Successfully",

        prescription,
      });

  } catch (e) {

    console.error(
      "SAVE PRESCRIPTION ERROR:",
      e
    );

    res
      .status(500)
      .json({
        success: false,
        message: e.message,
      });
  }
};


// ============================================================
// GET PATIENT PRESCRIPTIONS
// ============================================================

const getPatientPrescriptions =
  async (
    req,
    res
  ) => {

    try {

      const prescriptions =
        await Prescription.find({
          patientId:
            req.params.patientId,
        })
        .sort({
          createdAt: -1,
        });


      res.json(
        prescriptions
      );

    } catch (e) {

      res
        .status(500)
        .json({
          success: false,
          message: e.message,
        });
    }
  };



  // ============================================================
// DOWNLOAD PRESCRIPTION PDF
// ============================================================

const downloadPrescription = async (req, res) => {
  try {
    const { id } = req.params;

    console.log("");
    console.log("==============================================");
    console.log("🔥 HEALTHHOME PDF GENERATOR");
    console.log("Prescription ID:", id);
    console.log("Logo Path:", logoPath);
    console.log("Logo Exists:", fs.existsSync(logoPath));
    console.log("==============================================");
    console.log("");

    // ==========================================================
    // FIND PRESCRIPTION
    // ==========================================================

    const prescription = await Prescription.findById(id);

    if (!prescription) {
      return res.status(404).json({
        success: false,
        message: "Prescription not found",
      });
    }

    // ==========================================================
    // PAGE CONSTANTS
    // ==========================================================

    const PAGE_WIDTH = 595.28;
    const PAGE_HEIGHT = 841.89;

    const LEFT = 50;
    const RIGHT = 50;

    const CONTENT_WIDTH =
      PAGE_WIDTH - LEFT - RIGHT;

    // Header ends at 82
    const START_Y = 105;

    // Advertisement starts at:
    // PAGE_HEIGHT - 135 = 706
    //
    // So content MUST finish before ~680.
    const MAX_CONTENT_Y = 680;

    // ==========================================================
    // CREATE PDF
    // ==========================================================

    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      autoFirstPage: false,
    });

    // ==========================================================
    // RESPONSE
    // ==========================================================

    res.setHeader(
      "Content-Type",
      "application/pdf"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=Prescription-${id}.pdf`
    );

    doc.pipe(res);

    // ==========================================================
    // PAGE CREATION
    // ==========================================================

    let pageNumber = 0;

    const createPage = () => {
      pageNumber++;

      doc.addPage({
        size: "A4",
        margin: 0,
      });

      console.log(
        `📄 Created PDF page ${pageNumber}`
      );

      addHealthHomeHeader(doc);

      // VERY IMPORTANT:
      // Reset both x and y.
      doc.x = LEFT;
      doc.y = START_Y;
    };

    // ==========================================================
    // FINISH PAGE
    // ==========================================================

    const finishPage = () => {
      addHealthHomeAdvertisement(doc);
      addHealthHomeFooter(doc);
    };

    // ==========================================================
    // START FIRST PAGE
    // ==========================================================

    createPage();

    // ==========================================================
    // SAFE TEXT WRITER
    // ==========================================================

    const write = (
      text,
      font = "Helvetica",
      size = 10.5,
      gap = 3,
      indent = 0
    ) => {

      const value =
        text === undefined ||
        text === null
          ? ""
          : String(text);

      if (!value.trim()) {
        return;
      }

      const x =
        LEFT + indent;

      const width =
        CONTENT_WIDTH - indent;

      // --------------------------------------------------------
      // Calculate exact height
      // --------------------------------------------------------

      doc
        .font(font)
        .fontSize(size);

      const height =
        doc.heightOfString(
          value,
          {
            width: width,
            lineGap: 1,
          }
        );

      // --------------------------------------------------------
      // PAGE BREAK
      // --------------------------------------------------------

      if (
        doc.y + height + gap >
        MAX_CONTENT_Y
      ) {
        finishPage();
        createPage();

        doc
          .font(font)
          .fontSize(size);
      }

      // --------------------------------------------------------
      // DRAW TEXT
      // --------------------------------------------------------

      doc
        .fillColor(
          HEALTHHOME.text
        )
        .font(font)
        .fontSize(size)
        .text(
          value,
          x,
          doc.y,
          {
            width: width,
            align: "left",
            lineBreak: true,
            continued: false,
          }
        );

      // Small controlled gap
      doc.y += gap;
    };

    // ==========================================================
    // SECTION TITLE
    // ==========================================================

    const section = (title) => {

      write(
        title,
        "Helvetica-Bold",
        13,
        4
      );
    };

    // ==========================================================
    // PRESCRIPTION TITLE
    // ==========================================================

    write(
      "Prescription",
      "Helvetica-Bold",
      22,
      8
    );

    // Teal divider
    doc
      .moveTo(
        LEFT,
        doc.y
      )
      .lineTo(
        PAGE_WIDTH - RIGHT,
        doc.y
      )
      .lineWidth(1)
      .strokeColor(
        HEALTHHOME.primary
      )
      .stroke();

    doc.y += 10;

    // ==========================================================
    // PATIENT INFORMATION
    // ==========================================================

    write(
      `Doctor : ${prescription.doctorName || ""}`,
      "Helvetica",
      10.5,
      2
    );

    write(
      `Patient : ${prescription.patientName || ""}`,
      "Helvetica",
      10.5,
      2
    );

    write(
      `Phone : ${prescription.patientPhone || ""}`,
      "Helvetica",
      10.5,
      2
    );

    write(
      `Diagnosis : ${prescription.diagnosis || ""}`,
      "Helvetica",
      10.5,
      7
    );

    // ==========================================================
    // SYMPTOMS
    // ==========================================================

    if (
      Array.isArray(
        prescription.symptoms
      ) &&
      prescription.symptoms.length > 0
    ) {

      section("Symptoms");

      prescription.symptoms.forEach(
        (symptom) => {

          write(
            `• ${symptom}`,
            "Helvetica",
            10,
            2
          );

        }
      );

      doc.y += 5;
    }

    // ==========================================================
    // MEDICINES
    // ==========================================================

    section("Medicines");

    if (
      Array.isArray(
        prescription.medicines
      ) &&
      prescription.medicines.length > 0
    ) {

      prescription.medicines.forEach(
        (medicine, index) => {

          // ----------------------------------------------------
          // Medicine name
          // ----------------------------------------------------

          write(
            `${index + 1}. ${medicine.medicine || ""}`,
            "Helvetica-Bold",
            10.5,
            2
          );

          // ----------------------------------------------------
          // Dose
          // ----------------------------------------------------

          if (medicine.dose) {

            write(
              `Dose: ${medicine.dose}`,
              "Helvetica",
              9.5,
              1,
              15
            );

          }

          // ----------------------------------------------------
          // Duration
          // ----------------------------------------------------

          if (medicine.duration) {

            write(
              `Duration: ${medicine.duration}`,
              "Helvetica",
              9.5,
              1,
              15
            );

          }

          // ----------------------------------------------------
          // Food
          // ----------------------------------------------------

          if (medicine.food) {

            write(
              `Food: ${medicine.food}`,
              "Helvetica",
              9.5,
              1,
              15
            );

          }

          // ----------------------------------------------------
          // TIME
          // ----------------------------------------------------

          const times = [];

          if (
            medicine.morning
          ) {
            times.push(
              "Morning"
            );
          }

          if (
            medicine.afternoon
          ) {
            times.push(
              "Afternoon"
            );
          }

          if (
            medicine.night
          ) {
            times.push(
              "Night"
            );
          }

          if (
            times.length > 0
          ) {

            write(
              `Time: ${times.join(", ")}`,
              "Helvetica",
              9.5,
              1,
              15
            );

          }

          // ----------------------------------------------------
          // INSTRUCTION
          // ----------------------------------------------------

          if (
            medicine.instruction
          ) {

            write(
              `Instruction: ${medicine.instruction}`,
              "Helvetica",
              9.5,
              2,
              15
            );

          }

          doc.y += 4;
        }
      );

    } else {

      write(
        "No medicines prescribed.",
        "Helvetica",
        10,
        5
      );

    }

    // ==========================================================
    // LAB TESTS
    // ==========================================================

    section("Lab Tests");

    if (
      Array.isArray(
        prescription.labTests
      ) &&
      prescription.labTests.length > 0
    ) {

      prescription.labTests.forEach(
        (test, index) => {

          write(
            `${index + 1}. ${test.testName || ""}`,
            "Helvetica-Bold",
            10,
            2
          );

          write(
            `Priority: ${test.priority || "Normal"}`,
            "Helvetica",
            9.5,
            1,
            15
          );

          if (
            test.note
          ) {

            write(
              `Note: ${test.note}`,
              "Helvetica",
              9.5,
              2,
              15
            );

          }

          doc.y += 3;
        }
      );

    } else {

      write(
        "No lab tests prescribed.",
        "Helvetica",
        10,
        5
      );

    }

    // ==========================================================
    // ADVICE
    // ==========================================================

    if (
      prescription.advice &&
      String(
        prescription.advice
      ).trim()
    ) {

      section("Advice");

      write(
        prescription.advice,
        "Helvetica",
        10,
        3
      );

    }

    // ==========================================================
    // FINISH LAST PAGE
    // ==========================================================

    finishPage();

    console.log(
      `✅ PDF completed with ${pageNumber} page(s)`
    );

    // ==========================================================
    // END
    // ==========================================================

    doc.end();

  } catch (e) {

    console.error(
      "❌ PDF ERROR:",
      e
    );

    if (!res.headersSent) {

      return res
        .status(500)
        .json({
          success: false,
          message: e.message,
        });

    }
  }
};
// ============================================================
// SEND PRESCRIPTION
// ============================================================

const sendPrescription =
  async (
    req,
    res
  ) => {

    try {

      const {
        id
      } = req.params;


      const prescription =
        await Prescription.findById(
          id
        );


      if (!prescription) {

        return res
          .status(404)
          .json({

            success: false,

            message:
              "Prescription not found",

          });
      }


      prescription.status =
        "SENT";


      await prescription.save();


      if (
        prescription.appointmentId
      ) {

        await Appointment.findByIdAndUpdate(
          prescription.appointmentId,
          {
            prescriptionSent:
              true,
          }
        );
      }


      res.json({

        success: true,

        message:
          "Prescription sent successfully",

        prescription,

      });

    } catch (e) {

      console.error(
        "SEND PRESCRIPTION ERROR:",
        e
      );


      res
        .status(500)
        .json({

          success: false,

          message:
            e.message,

        });
    }
  };


// ============================================================
// EXPORT
// ============================================================

module.exports = {

  savePrescription,

  getPatientPrescriptions,

  downloadPrescription,

  sendPrescription,

};


// ============================================================
// EXPORT DEBUG
// ============================================================

console.log(
  "✅ Prescription controller exports:",
  {
    savePrescription:
      typeof savePrescription,

    getPatientPrescriptions:
      typeof getPatientPrescriptions,

    downloadPrescription:
      typeof downloadPrescription,

    sendPrescription:
      typeof sendPrescription,
  }
);