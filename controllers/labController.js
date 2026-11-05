const Lab = require("../models/lab");
const User = require("../models/user");
// ============================================================
// ADD LAB
// ============================================================


const addLab = async (req, res) => {
  try {
    // 1. Verify authenticated user
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    // 2. Only Laboratory accounts can create Lab profiles
    if (req.user.role !== "laboratory") {
      return res.status(403).json({
        success: false,
        message: "Only Laboratory accounts can create a Lab profile.",
      });
    }

    // 3. Get the actual registered user from MongoDB
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Registered user account not found.",
      });
    }

    if (!user.phone || !user.phone.trim()) {
      return res.status(400).json({
        success: false,
        message: "Registered phone number not found.",
      });
    }

    const {
      name,
      labType,
      experience,
      address,
    } = req.body;

    if (!name || !labType || !experience || !address) {
      return res.status(400).json({
        success: false,
        message: "All Lab profile fields are required.",
      });
    }

    // Always use the phone number stored in the authenticated account.
    const registeredPhone = user.phone.trim();

    // 4. Find existing Lab profile using registered phone
    let existingLab = await Lab.findOne({
      phone: registeredPhone,
    });

    if (existingLab) {
      // Prevent another account from taking ownership
      if (
        existingLab.userId &&
        String(existingLab.userId) !== String(user._id)
      ) {
        return res.status(403).json({
          success: false,
          message: "This Lab profile belongs to another account.",
        });
      }

      // Link existing legacy profile to authenticated user
      existingLab.userId = user._id;

      existingLab.name = name.trim();
      existingLab.labType = labType.trim();
      existingLab.experience = experience.trim();
      existingLab.address = address.trim();

      await existingLab.save();

      return res.status(200).json({
        success: true,
        message: "Lab profile updated and linked successfully.",
        lab: existingLab,
      });
    }

    // 5. Create new Lab profile with authenticated userId
    const lab = await Lab.create({
      userId: user._id,
      name: name.trim(),
      labType: labType.trim(),
      experience: experience.trim(),
      address: address.trim(),
      phone: registeredPhone,
    });

    return res.status(201).json({
      success: true,
      message: "Lab profile created and linked successfully.",
      lab,
    });

  } catch (error) {
    console.error("ADD LAB ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to save Lab profile.",
      error: error.message,
    });
  }
};


// ============================================================
// GET ALL LABS
// ============================================================

const getLabs = async (req, res) => {
  try {
    const labs = await Lab.find();

    res.status(200).json({
      success: true,
      labs,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// GET LAB PROFILE BY PHONE
// ============================================================

const getLabProfile = async (req, res) => {
  try {
    const lab = await Lab.findOne({
      phone: req.params.phone,
    });

    if (!lab) {
      return res.status(404).json({
        success: false,
        message: "Lab profile not found",
      });
    }

    return res.status(200).json({
      success: true,
      lab,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// LAB TEST MANAGEMENT
// ============================================================

// ============================================================
// ADD LAB TEST
// POST /api/labs/tests/add
// ============================================================

const addLabTest = async (req, res) => {
  try {
    const {
      labId,
      labName,
      labPhone,
      testName,
      category,
      price,
      sampleType,
      reportTime,
      description,
    } = req.body;

    // ---------------- VALIDATION ----------------

    if (!labId) {
      return res.status(400).json({
        success: false,
        message: "Lab ID is required",
      });
    }

    if (!testName || testName.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Test name is required",
      });
    }

    if (price === undefined || price === null || price === "") {
      return res.status(400).json({
        success: false,
        message: "Test price is required",
      });
    }

    const lab = await Lab.findById(labId);

    if (!lab) {
      return res.status(404).json({
        success: false,
        message: "Lab not found",
      });
    }

    // ---------------- DUPLICATE CHECK ----------------

    const existingTest = lab.tests.find(
      (test) =>
        test.testName.trim().toLowerCase() ===
        testName.trim().toLowerCase()
    );

    if (existingTest) {
      return res.status(400).json({
        success: false,
        message: "This test already exists in your lab",
      });
    }

    // ---------------- ADD TEST ----------------

    lab.tests.push({
      testName: testName.trim(),
      category: category?.trim() || "General",
      price: Number(price),
      sampleType: sampleType?.trim() || "Blood",
      reportTime: reportTime?.trim() || "24 Hours",
      description: description?.trim() || "",
      isActive: true,
    });

    await lab.save();

    const addedTest =
      lab.tests[lab.tests.length - 1];

    res.status(201).json({
      success: true,
      message: "Lab test added successfully",
      test: {
        _id: addedTest._id,
        labId: lab._id,
        labName: labName || lab.name,
        labPhone: labPhone || lab.phone,
        testName: addedTest.testName,
        category: addedTest.category,
        price: addedTest.price,
        sampleType: addedTest.sampleType,
        reportTime: addedTest.reportTime,
        description: addedTest.description,
        isActive: addedTest.isActive,
        createdAt: addedTest.createdAt,
        updatedAt: addedTest.updatedAt,
      },
    });
  } catch (error) {
    console.log("ADD LAB TEST ERROR:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// GET ALL LAB TESTS
// GET /api/labs/tests/all
// ============================================================

const getAllLabTests = async (req, res) => {
  try {
    const labs = await Lab.find();

    const tests = [];

    labs.forEach((lab) => {
      if (!lab.tests || lab.tests.length === 0) {
        return;
      }

      lab.tests.forEach((test) => {
        tests.push({
          _id: test._id,
          labId: lab._id,
          labName: lab.name,
          labPhone: lab.phone,
          labAddress: lab.address,

          testName: test.testName,
          category: test.category,
          price: test.price,
          sampleType: test.sampleType,
          reportTime: test.reportTime,
          description: test.description,
          isActive: test.isActive,

          createdAt: test.createdAt,
          updatedAt: test.updatedAt,
        });
      });
    });

    res.status(200).json({
      success: true,
      count: tests.length,
      tests,
    });
  } catch (error) {
    console.log("GET ALL LAB TESTS ERROR:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// GET LAB TESTS BY LAB
// GET /api/labs/tests/lab/:labId
// ============================================================

const getLabTestsByLab = async (req, res) => {
  try {
    const lab = await Lab.findById(req.params.labId);

    if (!lab) {
      return res.status(404).json({
        success: false,
        message: "Lab not found",
      });
    }

    const tests = (lab.tests || []).map((test) => ({
      _id: test._id,
      labId: lab._id,
      labName: lab.name,
      labPhone: lab.phone,
      labAddress: lab.address,

      testName: test.testName,
      category: test.category,
      price: test.price,
      sampleType: test.sampleType,
      reportTime: test.reportTime,
      description: test.description,
      isActive: test.isActive,

      createdAt: test.createdAt,
      updatedAt: test.updatedAt,
    }));

    res.status(200).json({
      success: true,
      count: tests.length,
      tests,
    });
  } catch (error) {
    console.log("GET LAB TESTS ERROR:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// UPDATE LAB TEST
// PUT /api/labs/tests/:id
// ============================================================

const updateLabTest = async (req, res) => {
  try {
    const {
      testName,
      category,
      price,
      sampleType,
      reportTime,
      description,
    } = req.body;

    if (!testName || testName.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Test name is required",
      });
    }

    if (price === undefined || price === null || price === "") {
      return res.status(400).json({
        success: false,
        message: "Test price is required",
      });
    }

    // Find the lab containing this test
    const lab = await Lab.findOne({
      "tests._id": req.params.id,
    });

    if (!lab) {
      return res.status(404).json({
        success: false,
        message: "Lab test not found",
      });
    }

    const test = lab.tests.id(req.params.id);

    if (!test) {
      return res.status(404).json({
        success: false,
        message: "Lab test not found",
      });
    }

    // Check duplicate test name
    const duplicate = lab.tests.find(
      (item) =>
        item._id.toString() !== req.params.id &&
        item.testName.trim().toLowerCase() ===
          testName.trim().toLowerCase()
    );

    if (duplicate) {
      return res.status(400).json({
        success: false,
        message: "Another test with this name already exists",
      });
    }

    test.testName = testName.trim();
    test.category = category?.trim() || "General";
    test.price = Number(price);
    test.sampleType = sampleType?.trim() || "Blood";
    test.reportTime = reportTime?.trim() || "24 Hours";
    test.description = description?.trim() || "";

    await lab.save();

    res.status(200).json({
      success: true,
      message: "Lab test updated successfully",
      test: {
        _id: test._id,
        labId: lab._id,
        labName: lab.name,
        labPhone: lab.phone,
        testName: test.testName,
        category: test.category,
        price: test.price,
        sampleType: test.sampleType,
        reportTime: test.reportTime,
        description: test.description,
        isActive: test.isActive,
        createdAt: test.createdAt,
        updatedAt: test.updatedAt,
      },
    });
  } catch (error) {
    console.log("UPDATE LAB TEST ERROR:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// DELETE LAB TEST
// DELETE /api/labs/tests/:id
// ============================================================

const deleteLabTest = async (req, res) => {
  try {
    const lab = await Lab.findOne({
      "tests._id": req.params.id,
    });

    if (!lab) {
      return res.status(404).json({
        success: false,
        message: "Lab test not found",
      });
    }

    const test = lab.tests.id(req.params.id);

    if (!test) {
      return res.status(404).json({
        success: false,
        message: "Lab test not found",
      });
    }

    test.deleteOne();

    await lab.save();

    res.status(200).json({
      success: true,
      message: "Lab test deleted successfully",
    });
  } catch (error) {
    console.log("DELETE LAB TEST ERROR:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// TOGGLE LAB TEST ACTIVE / INACTIVE
// PUT /api/labs/tests/toggle/:id
// ============================================================

const toggleLabTest = async (req, res) => {
  try {
    const lab = await Lab.findOne({
      "tests._id": req.params.id,
    });

    if (!lab) {
      return res.status(404).json({
        success: false,
        message: "Lab test not found",
      });
    }

    const test = lab.tests.id(req.params.id);

    if (!test) {
      return res.status(404).json({
        success: false,
        message: "Lab test not found",
      });
    }

    test.isActive = !test.isActive;

    await lab.save();

    res.status(200).json({
      success: true,
      message: test.isActive
        ? "Lab test enabled successfully"
        : "Lab test disabled successfully",

      test: {
        _id: test._id,
        labId: lab._id,
        labName: lab.name,
        labPhone: lab.phone,
        testName: test.testName,
        category: test.category,
        price: test.price,
        sampleType: test.sampleType,
        reportTime: test.reportTime,
        description: test.description,
        isActive: test.isActive,
      },
    });
  } catch (error) {
    console.log("TOGGLE LAB TEST ERROR:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// EXPORT
// ============================================================

module.exports = {
  addLab,
  getLabs,
  getLabProfile,

  // Lab Test Management
  addLabTest,
  getAllLabTests,
  getLabTestsByLab,
  updateLabTest,
  deleteLabTest,
  toggleLabTest,
};