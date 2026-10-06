const express = require("express");
const cors = require("cors");
const config = require("./config/env");
const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const repairRoutes = require("./routes/repairRoutes");

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Accessibility Repair Engine API is running.",
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/repair", repairRoutes);

async function startServer() {
  await connectDB();

  const port = config.port;

  return app.listen(port, () => {
    console.log(`Server listening on port ${port}.`);
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error("Server startup failed:", error);
    process.exitCode = 1;
  });
}

module.exports = {
  app,
  startServer,
};