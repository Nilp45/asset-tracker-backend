const express = require("express");
const router = express.Router();

const Session = require("../models/Session");
const Scan = require("../models/Scan");
const Asset = require("../models/Asset");

/* =========================================================
   GET TRANSACTIONS + SHORT QTY DOCUMENTS
   ========================================================= */
router.get("/", async (req, res) => {
  try {
    const { plantId, assetId, invoice, from, to, mode } = req.query;

    if (!plantId) {
      return res.status(400).json({ error: "Plant is required" });
    }

    /* ================= FILTER BUILD ================= */
    const scanFilter = { plantId };

    if (assetId) scanFilter.assetId = assetId;
    if (mode) scanFilter.mode = mode;

    if (from || to) {
      scanFilter.createdAt = {};
      if (from) scanFilter.createdAt.$gte = new Date(from);
      if (to) scanFilter.createdAt.$lte = new Date(to);
    }

    /* ================= TRANSACTION TABLE ================= */
    const transactions = await Scan.aggregate([
      { $match: scanFilter },

      {
        $lookup: {
          from: "sessions",
          localField: "sessionId",
          foreignField: "_id",
          as: "session"
        }
      },
      { $unwind: "$session" },

      ...(invoice
        ? [{ $match: { "session.documentNo": invoice } }]
        : []),

      {
        $lookup: {
          from: "assets",
          localField: "assetId",
          foreignField: "assetId",
          as: "asset"
        }
      },
      { $unwind: { path: "$asset", preserveNullAndEmptyArrays: true } },

      {
        $project: {
          assetId: 1,
          assetType: "$asset.assetType",
          description: "$asset.description",
          mode: 1,
          documentNo: "$session.documentNo",
          plantId: 1,
          byUser: 1,
          movementTime: "$createdAt"
        }
      },

      { $sort: { movementTime: -1 } }
    ]);

    /* ================= SHORT QTY DOCUMENTS ================= */
    const shortQtyDocs = await Session.aggregate([
      {
        $match: {
          plantId,
          status: "completed",
          totalQty: { $gt: 0 }
        }
      },

      /* ✅ FIELD TO FIELD COMPARISON (THIS FIXES YOUR ERROR) */
      {
        $match: {
          $expr: { $lt: ["$scannedQty", "$totalQty"] }
        }
      },

      ...(invoice ? [{ $match: { documentNo: invoice } }] : []),

      {
        $project: {
          documentNo: 1,
          totalQty: 1,
          scannedQty: 1,
          plantId: 1,
          createdBy: 1,
          remark: 1,
          createdAt: 1
        }
      },

      { $sort: { createdAt: -1 } }
    ]);

    /* ================= RESPONSE ================= */
    res.json({
      transactions,
      shortQty: shortQtyDocs
    });

  } catch (err) {
    console.error("Transaction API error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
