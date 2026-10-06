const path = require("path");

require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});

module.exports = {
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGO_URI,
  jwtSecretKey: process.env.JWT_SECRET_KEY,
};
