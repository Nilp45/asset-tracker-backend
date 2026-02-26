require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const auth = require("./middleware/auth");

const User = require("./models/User");
const Asset = require("./models/Asset");
const Session = require("./models/Session");
const Scan = require("./models/Scan");
const Plant = require("./models/Plant");

const adminRoutes = require("./routes/admin.routes");
const assetRoutes = require("./routes/asset.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const challanRoutes = require("./routes/challan.routes");
const transactionRoutes = require("./routes/transaction.routes");
const assetRequestRoutes = require('./routes/asset_request.routes');

const app = express();



/* ================= CORS (PRODUCTION SAFE) ================= */
const allowedOrigins = [
  "http://localhost:5500",
  "http://127.0.0.1:5500",
 "https://asset-trackerv001.netlify.app"
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow Postman / server-to-server / same-origin
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(
      new Error("CORS blocked for origin: " + origin),
      false
    );
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

app.options("*", cors());
app.use(express.json());

/* ================= HEALTH CHECK ================= */
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    uptime: process.uptime(),
    timestamp: new Date()
  });
});

/* ================= DB ================= */
mongoose.connect(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 5000,   // Faster failure if DB not reachable
  socketTimeoutMS: 45000,
  maxPoolSize: 10
})
.then(() => console.log("✅ MongoDB connected"))
.catch(err => {
  console.error("MongoDB Connection Error:", err);
  process.exit(1);
});


/* ================= LOGIN ================= */
app.post("/api/login", async (req, res) => {  
  const { username, password } = req.body;

  const user = await User.findOne({ username, active: true });
  if (!user) return res.status(401).json({ error: "User not found" });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Incorrect password" });

  const token = jwt.sign(
    {
      userId: user._id.toString(),
      username: user.username,
      role: user.role
    },
    process.env.JWT_SECRET,
    { expiresIn: "8h" }
  );

  res.json({
    token,
    forcePasswordChange: user.forcePasswordChange,
    plantId: user.plantId || null
  });
});

/* ================= PLANTS ================= */
app.get("/api/admin/plants", auth, async (req, res) => {
  res.json(await Plant.find({ active: true }).sort({ plantId: 1 }));
});

/* ================= SESSION START ================= */
app.post("/api/session/start", auth, async (req, res) => {
  const { mode, documentNo, totalQty, plantId } = req.body;

  if (!plantId)
    return res.status(400).json({ error: "Plant not selected" });

  if (mode === "IN" || mode === "OUT") {

    if (!documentNo)
      return res.status(400).json({ error: "Document number required" });

    if (!totalQty || totalQty <= 0)
      return res.status(400).json({ error: "Quantity must be > 0" });

    // 🔥 DUPLICATE DOCUMENT CHECK AT START BUTTON
    const existing = await Session.findOne({
      documentNo,
      plantId,
      mode,
      status: "completed"
    });

    if (existing) {
      return res.status(400).json({
        error: "Duplicate completed document not allowed"
      });
    }
  }

  // Validation only
  res.json({ ok: true });
});


/* ================= SCAN ================= */
app.post("/api/scan", auth, async (req, res) => {

  let { sessionId, assetId, plantId, mode, documentNo, totalQty } = req.body;

  assetId = assetId.toUpperCase();

  if (!mode || !plantId)
    return res.status(400).json({ error: "Invalid scan data" });

  /* ================= FETCH ASSET ================= */

  const asset = await Asset.findOne({ assetId, plantId });

  if (!asset)
    return res.status(400).json({ error: "Asset not found" });

  if (!asset.active)
    return res.status(400).json({ error: "Asset disabled" });

  /* ================= MOVEMENT VALIDATION USING STATUS ================= */

  const currentStatus = asset.status || "AVAILABLE";

  const invalid =
    (currentStatus === "AVAILABLE" && mode === "IN") ||          // Already at plant
    (currentStatus === "AT_CUSTOMER" && mode === "OUT") ||       // Already out
    (currentStatus !== "AT_CUSTOMER" && mode === "IN") ||        // IN only from customer
    (currentStatus !== "AVAILABLE" && mode === "OUT") ||         // OUT only from plant
    (currentStatus !== "AVAILABLE" && mode === "MAINT") ||       // MAINT only from plant
    (currentStatus !== "AT_MAINTENANCE" && mode === "OK");       // OK only from maintenance

  if (invalid)
    return res.status(400).json({ error: "Invalid movement" });

  /* ================= FETCH SESSION ================= */

  let session = null;

  if (sessionId) {
    session = await Session.findById(sessionId);
    if (!session || session.status !== "active")
      return res.status(400).json({ error: "Invalid session" });
  }

  /* ================= FIRST VALID SCAN → CREATE SESSION ================= */

  if (!session) {

    if (mode === "IN" || mode === "OUT") {

      if (!documentNo || !totalQty)
        return res.status(400).json({
          error: "Document and quantity required"
        });
    }

    session = await Session.create({
      mode,
      documentNo: documentNo || null,
      totalQty: totalQty || null,
      plantId,
      createdBy: req.user.username,
      scannedQty: 0,
      status: "active"
    });

    sessionId = session._id;
  }

  /* ================= DUPLICATE SCAN CHECK ================= */

  if (await Scan.findOne({ sessionId, assetId }))
    return res.status(400).json({ error: "Duplicate scan" });

  /* ================= SAVE SCAN ================= */

  await Scan.create({
    sessionId,
    assetId,
    plantId,
    mode,
    byUser: req.user.username
  });

  session.scannedQty++;

  /* ================= UPDATE ASSET STATUS ================= */

  if (mode === "OUT") asset.status = "AT_CUSTOMER";
  if (mode === "IN") asset.status = "AVAILABLE";
  if (mode === "MAINT") asset.status = "AT_MAINTENANCE";
  if (mode === "OK") asset.status = "AVAILABLE";

  if (mode === "IN") asset.cycleSinceOk++;
  if (mode === "OK") {
    asset.cycleSinceOk = 0;
    asset.lastOkAt = new Date();
  }

  await asset.save();

  /* ================= OUT AUTO COMPLETE ================= */

  if (
    mode === "OUT" &&
    session.totalQty &&
    session.scannedQty === session.totalQty
  ) {

    session.status = "completed";
    await session.save();

    return res.json({
      sessionId,
      scannedQty: session.scannedQty,
      remainingQty: 0,
      autoClose: true
    });
  }

  await session.save();

  res.json({
    sessionId,
    scannedQty: session.scannedQty,
    remainingQty: session.totalQty
      ? session.totalQty - session.scannedQty
      : null
  });

});


/* ================= SESSION CLOSE ================= */
app.post("/api/session/close", auth, async (req, res) => {
  const { sessionId } = req.body;

  const session = await Session.findById(sessionId);
  if (!session || session.status !== "active")
    return res.status(400).json({ error: "Invalid session" });

  /* 🚫 OUT = FULL OR NOTHING */
  if (session.mode === "OUT" && session.scannedQty < session.totalQty) {
    await Scan.deleteMany({ sessionId });
    await Session.deleteOne({ _id: sessionId });

    return res.status(400).json({
      error: "OUT scanning incomplete. Session cancelled and rolled back."
    });
  }

  if (session.totalQty && session.scannedQty < session.totalQty) {
    session.remark =
      `${session.totalQty - session.scannedQty} qty short against document`;
  }

  session.status = "completed";
  await session.save();

  res.json({ ok: true });
});

/* ================= SESSION CANCEL ================= */
app.post("/api/session/cancel", auth, async (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: "Session ID required" });
  }

  const session = await Session.findById(sessionId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  // 🔥 DELETE ALL SCANS FIRST
  await Scan.deleteMany({ sessionId });

  // 🔥 DELETE SESSION
  await Session.deleteOne({ _id: sessionId });

  res.json({ ok: true });
});


/* ================= CHANGE PASSWORD ================= */
app.post("/api/change-password", auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword)
      return res.status(400).json({ error: "All fields required" });

    if (newPassword.length < 6)
      return res.status(400).json({ error: "Password too short" });

    const user = await User.findById(req.user.userId);
    if (!user)
      return res.status(404).json({ error: "User not found" });

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok)
      return res.status(403).json({ error: "Current password incorrect" });

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.forcePasswordChange = false;
    user.tokenVersion += 1;
    await user.save();

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


/* ================= ROUTES ================= */
app.use("/api/admin", auth, adminRoutes);
app.use("/api/assets", assetRoutes);
app.use("/api/dashboard", auth, dashboardRoutes);
app.use("/api/challan", challanRoutes);
app.use("/api/transactions", auth, transactionRoutes);
app.use('/api/asset-request', auth, assetRequestRoutes);


/* ================= START ================= */
app.listen(5000, () => {
  console.log("🚀 Server running on http://localhost:5000");
});
