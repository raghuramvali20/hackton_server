const mongoose = require("mongoose");
const config = require("./env");

async function connectDB() {
  if (!config.mongoUri) {
    throw new Error("MONGO_URI is not configured.");
  }

  await mongoose.connect(config.mongoUri);
  console.log("MongoDB connected.");
}

module.exports = connectDB;
