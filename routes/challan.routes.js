const express = require("express");
const router = express.Router();

const Session = require("../models/Session");
const Scan = require("../models/Scan");
const Asset = require("../models/Asset");
const Plant = require("../models/Plant");

/* ================= GET CHALLAN BY INVOICE ================= */
router.get("/by-invoice/:invoice", async (req, res) => {
  try {
    const { invoice } = req.params;
    const { plantId } = req.query;

    if (!plantId) {
      return res.status(400).json({ error: "Plant required" });
    }

    /* ✅ SESSION MUST BE COMPLETED */
    const session = await Session.findOne({
      documentNo: invoice,
      plantId,
      status: "completed",
      scannedQty: { $gt: 0 }
    });

    if (!session) {
      return res.status(404).json({
        error: "Challan can be generated only after scanning completion"
      });
    }

    const plant = await Plant.findOne({ plantId });
    if (!plant) {
      return res.status(400).json({ error: "Plant not found" });
    }

    /* ✅ GROUP SCANS (ASSET TYPE + DESC) */
    const items = await Scan.aggregate([
      { $match: { sessionId: session._id, plantId } },
      {
        $lookup: {
          from: "assets",
          localField: "assetId",
          foreignField: "assetId",
          as: "asset"
        }
      },
      { $unwind: "$asset" },
      {
        $group: {
          _id: {
            assetType: "$asset.assetType",
            description: "$asset.description",
            hsn: "$asset.hsn",
            uom: "$asset.uom"
          },
          qty: { $sum: 1 }
        }
      }
    ]);

    if (items.length === 0) {
      return res.status(400).json({ error: "No scanned assets" });
    }

    res.json({
      invoice,
      totalQty: session.scannedQty,   // ✅ ADD THIS LINE
      challanQty: session.scannedQty, // (keep if you want)
      plantId,
      plantAddress: plant.address || "",
      transporter: session.transporter,
      transportMode: session.transportMode,
      vehicleNo: session.vehicleNo,
      shipToAddress: session.shipToAddress,
      items: items.map(i => ({
        assetType: i._id.assetType,
        description: i._id.description,
        hsn: i._id.hsn || "",
        uom: i._id.uom || "NOS",
        qty: i.qty
      }))
  });


  } catch (err) {
    console.error("Challan API error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ================= SAVE TRANSPORT ================= */
router.post("/save-transport", async (req, res) => {
  const {
    invoice,
    plantId,
    transporter,
    transportMode,
    vehicleNo,
    shipToAddress
  } = req.body;

  const session = await Session.findOne({
    documentNo: invoice,
    plantId,
    status: "completed"
  });

  if (!session) {
    return res.status(400).json({ error: "Session not completed" });
  }

  session.transporter = transporter;
  session.transportMode = transportMode;
  session.vehicleNo = vehicleNo;
  session.shipToAddress = shipToAddress;

  await session.save();

  res.json({ ok: true });
});

module.exports = router;
