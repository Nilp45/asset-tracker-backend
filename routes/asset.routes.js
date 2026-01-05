const express = require("express");
const router = express.Router();
const Asset = require("../models/Asset");
const Scan = require("../models/Scan");

/*
 PM Pending = cycleSinceOk >= pmCycle
*/
router.get("/pm-pending", async (req, res) => {
  try {
    const { plantId } = req.query;
    if (!plantId) {
      return res.status(400).json({ error: "Plant required" });
    }

    const assets = await Asset.find({
      plantId,
      active: true,
      pmCycle: { $gt: 0 },
      $expr: { $gte: ["$cycleSinceOk", "$pmCycle"] }
    }).lean();

    res.json(
      assets.map(a => ({
        assetId: a.assetId,
        description: a.description || "-",
        assetType: a.assetType,
        customer: a.customer,
        cycleSinceOk: a.cycleSinceOk,
        pmCycle: a.pmCycle,
        status: "PM DUE"
      }))
    );
  } catch (err) {
    console.error("PM pending error", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
