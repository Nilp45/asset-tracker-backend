require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

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

const app = express();

/* ================= CORS ================= */
app.use(cors({
  origin: ["http://127.0.0.1:5500", "http://localhost:5500"],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.options("*", cors());

app.use(express.json());

/* ================= DB ================= */
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });

/* ================= AUTH ================= */
function auth(req, res, next) {
  const hdr = req.headers.authorization;

  /* 🔓 Allow change-password without strict auth */
  if (req.path === "/change-password") {
    if (!hdr) return res.status(401).json({ error: "Token missing" });

    try {
      req.user = jwt.verify(hdr.split(" ")[1], process.env.JWT_SECRET);
      return next();
    } catch {
      return res.status(403).json({ error: "Invalid token" });
    }
  }

  /* 🔒 Normal protected routes */
  if (!hdr) {
    return res.status(401).json({ error: "Session expired" });
  }

  try {
    req.user = jwt.verify(hdr.split(" ")[1], process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(403).json({ error: "Invalid token" });
  }
}


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
      role: user.role,
      tokenVersion: { type: Number, default: 0 }
    },
    process.env.JWT_SECRET,
    { expiresIn: "8h" }
  );

  res.json({
    token,
    forcePasswordChange: user.forcePasswordChange,
    plantId: user.plantId || null   // 🔥 REQUIRED
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

    const existing = await Session.findOne({
      documentNo,
      plantId,
      status: "completed"
    });

    if (existing) {
      return res.status(400).json({
        error: "Duplicate completed document not allowed"
      });
    }
  }

  const session = await Session.create({
    mode,
    documentNo: documentNo || null,
    totalQty: totalQty || null,
    plantId,
    createdBy: req.user.username,
    scannedQty: 0,
    status: "active"
  });

  res.json({ sessionId: session._id });
});

/* ================= SCAN ================= */
app.post("/api/scan", auth, async (req, res) => {
  let { sessionId, assetId, plantId } = req.body;
  assetId = assetId.toUpperCase();

  const session = await Session.findById(sessionId);
  if (!session || session.status !== "active")
    return res.status(400).json({ error: "Invalid or closed session" });

  const asset = await Asset.findOne({ assetId, plantId, active: true });
  if (!asset)
    return res.status(400).json({ error: "Asset not found" });

  if (await Scan.findOne({ sessionId, assetId }))
    return res.status(400).json({ error: "Duplicate scan" });

  const lastScan = await Scan.findOne({ assetId, plantId })
    .sort({ createdAt: -1 });

  let currentStatus = "NO_MOVEMENT";
  if (lastScan) {
    if (["IN", "OK"].includes(lastScan.mode)) currentStatus = "AT_PLANT";
    else if (lastScan.mode === "OUT") currentStatus = "AT_CUSTOMER";
    else if (lastScan.mode === "MAINT") currentStatus = "AT_MAINTENANCE";
  }

  const invalid =
    (currentStatus === "AT_PLANT" && session.mode === "IN") ||
    (currentStatus === "AT_CUSTOMER" && session.mode === "OUT") ||
    (currentStatus === "AT_MAINTENANCE" && ["IN", "OUT"].includes(session.mode)) ||
    (currentStatus !== "AT_MAINTENANCE" && session.mode === "OK") ||
    (currentStatus !== "AT_PLANT" && session.mode === "MAINT");

  if (invalid)
    return res.status(400).json({ error: "Invalid movement" });

  await Scan.create({
    sessionId,
    assetId,
    plantId,
    mode: session.mode,
    byUser: req.user.username
  });

  if (session.mode === "IN") asset.cycleSinceOk++;
  if (session.mode === "OK") {
    asset.cycleSinceOk = 0;
    asset.lastOkAt = new Date();
  }
  await asset.save();

  session.scannedQty++;

  if (session.totalQty && session.scannedQty >= session.totalQty) {
    session.status = "completed";
  }

  await session.save();

  res.json({
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

  if (session.totalQty && session.scannedQty < session.totalQty) {
    session.remark =
      `${session.totalQty - session.scannedQty} qty short against document`;
  }

  session.status = "completed";
  await session.save();

  res.json({ ok: true });
});

/* ================= CHANGE PASSWORD ================= */
app.post("/api/change-password", auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "All fields required" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: "Password too short" });
    }

    if (!req.user || !req.user.userId) {
      return res.status(401).json({ error: "Invalid session" });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      return res.status(403).json({ error: "Current password incorrect" });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.forcePasswordChange = false;

    user.tokenVersion += 1; // 🔥 invalidate all existing tokens
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

/* ================= START ================= */
app.listen(5000, () => {
  console.log("🚀 Server running on http://localhost:5000");
});
