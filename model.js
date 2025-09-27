const mongoose = require("mongoose");

// Meme Schema
const memeSchema = new mongoose.Schema({
  cid: String,
  isTemplate: Boolean,
  memeTemplate: String,
  attestationHash: String,
  // type: String,
});

const Meme = mongoose.model("MantleMemes", memeSchema);

const GasSchema = new mongoose.Schema({
  address: String
});

const GasModel = mongoose.model("MantleGasSchema", GasSchema);


module.exports = { Meme, GasModel};
