const express = require("express");
const router = express.Router();
const Session = require("../models/Session");

/* ================= START SESSION ================= */
router.post("/start", async (req, res) => {
  
  try {
    const { mode, documentNo, totalQty, plantId } = req.body;

    if (!plantId) {
      return res.status(400).json({ error: "Plant not selected" });
    }

    // IN / OUT duplicate document check
    if (mode === "IN" || mode === "OUT") {
      if (!documentNo) {
        return res.status(400).json({ error: "Document number required" });
      }

      const exists = await Session.findOne({
        plantId,
        documentNo,
        status: { $ne: "draft" }
      });

      if (exists) {
        return res.status(400).json({
          error: "Duplicate document number"
        });
      }
    }

    // Create draft session
    const session = await Session.create({
      mode,
      documentNo: documentNo || null,
      totalQty: totalQty || null,
      scannedQty: 0,
      plantId,                     // 🔑 FIX
      createdBy: req.user.username,
      status: "draft"
    });

    res.json({ sessionId: session._id });

  } catch (e) {
    console.error("Session start error:", e);
    res.status(500).json({ error: "Session start failed" });
  }
});

module.exports = router;
