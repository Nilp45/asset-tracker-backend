const express = require("express");
const router = express.Router();

const Asset = require("../models/Asset");
const Scan = require("../models/Scan");

/* ================= DASHBOARD SUMMARY ================= */
router.get("/summary", async (req, res) => {
  try {
    const { plantId } = req.query;
    if (!plantId) {
      return res.status(400).json({ error: "Plant not selected" });
    }

    /* ===== GET LAST SCAN PER ASSET ===== */
    const lastScans = await Scan.aggregate([
      { $match: { plantId } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$assetId",
          mode: { $first: "$mode" },
          scannedAt: { $first: "$createdAt" }
        }
      }
    ]);

    const lastScanMap = {};
    lastScans.forEach(s => {
      lastScanMap[s._id] = s;
    });

    /* ===== LOAD ASSETS ===== */
    const assets = await Asset.find({ plantId, active: true });

    const now = new Date();

    const overallMap = {};
    const topAging = [];
    const topMaint = [];

    let totalPendingMaint = 0;
    let totalUnderMaint = 0;

    for (const asset of assets) {
      const last = lastScanMap[asset.assetId];

      let status = "NO_MOVEMENT";
      let agingMin = 0;

      if (last) {
        agingMin = Math.floor((now - last.scannedAt) / 60000);

        if (["IN", "OK"].includes(last.mode)) status = "AT_PLANT";
        else if (last.mode === "OUT") status = "AT_CUSTOMER";
        else if (last.mode === "MAINT") status = "AT_MAINTENANCE";
      }

      /* ===== AGING TABLE ===== */
      if (status === "AT_CUSTOMER") {
        topAging.push({
          assetId: asset.assetId,
          customer: asset.customer,
          agingMin
        });
      }

      /* ===== MAINTENANCE ===== */
      if (asset.cycleSinceOk >= asset.pmCycle) {
        totalPendingMaint++;
        topMaint.push({
          assetId: asset.assetId,
          customer: asset.customer,
          agingMin
        });
      }

      if (status === "AT_MAINTENANCE") {
        totalUnderMaint++;
      }

      /* ===== OVERALL GROUP ===== */
      const key = `${asset.customer}|${asset.description}|${asset.assetType}`;

      if (!overallMap[key]) {
        overallMap[key] = {
          customer: asset.customer,
          description: asset.description || "-",
          assetType: asset.assetType,
          atCustomer: 0,
          atPlant: 0,
          atMaint: 0,
          noMove: 0
        };
      }

      if (status === "AT_CUSTOMER") overallMap[key].atCustomer++;
      else if (status === "AT_PLANT") overallMap[key].atPlant++;
      else if (status === "AT_MAINTENANCE") overallMap[key].atMaint++;
      else overallMap[key].noMove++;
    }

    /* ===== SORT + FORMAT AGING ===== */
    function fmt(min) {
      const d = Math.floor(min / 1440);
      const h = Math.floor((min % 1440) / 60);
      const m = min % 60;
      return `${String(d).padStart(2,"0")}:${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
    }

    topAging.sort((a,b)=>b.agingMin-a.agingMin);
    topMaint.sort((a,b)=>b.agingMin-a.agingMin);

    res.json({
      topAging: topAging.slice(0,5).map(x=>({
        assetId: x.assetId,
        customer: x.customer,
        aging: fmt(x.agingMin)
      })),
      topMaint: topMaint.slice(0,5).map(x=>({
        assetId: x.assetId,
        customer: x.customer,
        aging: fmt(x.agingMin)
      })),
      totalPendingMaint,
      totalUnderMaint,
      overall: Object.values(overallMap)
    });

  } catch (e) {
    console.error("Dashboard error", e);
    res.status(500).json({ error: "Dashboard failed" });
  }
});

module.exports = router;
