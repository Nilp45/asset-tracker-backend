const express = require("express");
const router = express.Router();

const Asset = require("../models/Asset");
const Scan = require("../models/Scan");
const Session = require("../models/Session");

/* ================= SCAN ================= */
router.post("/", async (req, res) => {
  try {
    let { sessionId, assetId } = req.body;
    assetId = assetId.toUpperCase();

    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(400).json({ error: "Invalid session" });
    }

    // Asset must belong to SAME PLANT as session
    const asset = await Asset.findOne({
      assetId,
      plantId: session.plantId,
      active: true
    });

    if (!asset) {
      return res.status(400).json({ error: "Asset not in master data" });
    }

    const dup = await Scan.findOne({ sessionId, assetId });
    if (dup) {
      return res.status(400).json({ error: "Duplicate scan" });
    }

    if (session.status === "draft") {
      session.status = "active";
    }

    await Scan.create({
      sessionId,
      assetId,
      plantId: session.plantId,
      mode: session.mode,
      byUser: req.user.username
    });

    session.scannedQty++;

    if (
      session.totalQty &&
      session.scannedQty >= session.totalQty
    ) {
      session.status = "completed";
    }

    await session.save();

    res.json({
      scannedQty: session.scannedQty,
      remainingQty: session.totalQty
        ? session.totalQty - session.scannedQty
        : null
    });

  } catch (e) {
    console.error("Scan error:", e);
    res.status(500).json({ error: "Scan failed" });
  }
});

module.exports = router;
