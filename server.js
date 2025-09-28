// server/server.js - Updated with Auto-Settlement
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const { Meme, GasModel } = require("./model");
const { SettlementRecord, UserVote } = require("./models/Settlement");
const { ethers, parseEther, Contract } = require("ethers");
const CONTRACT = require("./FunnyOrFud.json");
const AutoSettlementService = require("./services/settlementService");
require("dotenv").config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Initialize ethers.js provider and wallet
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const relayerWallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const contractAddress = "0xbCD7cd28A214772A8E785E1f2E0ca19f01FdCEf4";
const contractABI = CONTRACT.abi;

// Initialize Auto-Settlement Service
const settlementService = new AutoSettlementService();
settlementService.start();

// Health Check
app.get("/api/health", async (req, res) => {
  try {
    res.status(200).json({
      status: "healthy",
      settlement_service: "running",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Generate secure nonce for wallet authentication
app.get("/api/nonce", async (req, res) => {
  try {
    // Generate a secure nonce (at least 8 alphanumeric characters as per MiniKit docs)
    const generateSecureNonce = () => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let result = '';
      for (let i = 0; i < 16; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    };

    const nonce = generateSecureNonce();

    // In a production app, you should store this nonce temporarily (e.g., in Redis)
    // and associate it with the user session for verification

    res.json({
      nonce,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() // 5 minutes
    });
  } catch (error) {
    console.error("Error generating nonce:", error);
    res.status(500).json({ message: "Failed to generate nonce", error: error.message });
  }
});

// Track user votes when they vote
app.post("/api/user-vote", async (req, res) => {
  const { userAddress, marketId, vote, transactionHash } = req.body;
  
  if (!userAddress || marketId === undefined || !vote) {
    return res.status(400).json({ message: "Missing required parameters" });
  }

  try {
    // Check if user already voted
    const existingVote = await UserVote.findOne({ userAddress, marketId });
    if (existingVote) {
      return res.status(400).json({ message: "User already voted on this market" });
    }

    // Save user vote
    const userVote = new UserVote({
      userAddress,
      marketId,
      vote,
      transactionHash
    });

    await userVote.save();
    res.json({ message: "Vote recorded successfully" });
  } catch (error) {
    console.error("Error recording user vote:", error);
    res.status(500).json({ message: "Failed to record vote", error: error.message });
  }
});

// Get user's voting history
app.get("/api/user-votes/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const userVotes = await UserVote.find({ userAddress: address }).sort({ votedAt: -1 });
    
    res.json(userVotes);
  } catch (error) {
    console.error("Error fetching user votes:", error);
    res.status(500).json({ message: error.message });
  }
});

// Get user's settlement history
app.get("/api/user-settlements/:address", async (req, res) => {
  try {
    const { address } = req.params;
    
    // Find all settlements where user participated
    const settlements = await SettlementRecord.find({
      "participants.address": address
    }).sort({ settledAt: -1 });

    // Calculate user-specific data for each settlement
    const userSettlements = settlements.map(settlement => {
      const userParticipation = settlement.participants.find(p => p.address === address);
      
      return {
        marketId: settlement.marketId,
        winnerSide: settlement.winnerSide,
        userVote: userParticipation.vote,
        userWon: userParticipation.won,
        userStake: userParticipation.staked,
        userPayout: userParticipation.payout,
        netResult: userParticipation.won ? 
          (BigInt(userParticipation.payout) - BigInt(userParticipation.staked)).toString() : 
          (-BigInt(userParticipation.staked)).toString(),
        totalVotes: settlement.totalVotes,
        yesVotes: settlement.yesVotes,
        noVotes: settlement.noVotes,
        settlementTx: settlement.settlementTx,
        settledAt: settlement.settledAt
      };
    });

    res.json(userSettlements);
  } catch (error) {
    console.error("Error fetching user settlements:", error);
    res.status(500).json({ message: error.message });
  }
});

// Get settlement details for a specific market
app.get("/api/settlement/:marketId", async (req, res) => {
  try {
    const { marketId } = req.params;
    const settlement = await SettlementRecord.findOne({ marketId: parseInt(marketId) });
    
    if (!settlement) {
      return res.status(404).json({ message: "Settlement not found" });
    }
    
    res.json(settlement);
  } catch (error) {
    console.error("Error fetching settlement:", error);
    res.status(500).json({ message: error.message });
  }
});

// Manual settlement trigger (admin endpoint)
app.post("/api/manual-settle/:marketId", async (req, res) => {
  try {
    const { marketId } = req.params;
    
    console.log(`Manual settlement requested for market ${marketId}`);
    const success = await settlementService.manualSettle(parseInt(marketId));
    
    if (success) {
      res.json({ message: `Market ${marketId} settled successfully` });
    } else {
      res.status(400).json({ message: `Failed to settle market ${marketId}` });
    }
  } catch (error) {
    console.error("Manual settlement error:", error);
    res.status(500).json({ message: "Settlement failed", error: error.message });
  }
});

// Get settlement status for a market
app.get("/api/settlement-status/:marketId", async (req, res) => {
  try {
    const { marketId } = req.params;
    const status = await settlementService.getSettlementStatus(parseInt(marketId));
    
    res.json(status);
  } catch (error) {
    console.error("Error getting settlement status:", error);
    res.status(500).json({ message: error.message });
  }
});

// Existing Routes (keeping all the original functionality)

// Relay Transaction Route
app.post("/api/relay", async (req, res) => {
  const { userAddress, marketId, voteYes } = req.body;

  if (!userAddress || marketId === undefined || voteYes === undefined) {
    return res.status(400).json({ message: "Missing required parameters" });
  }

  try {
    const contract = new Contract(contractAddress, contractABI, relayerWallet);
    const voteCost = parseEther("0.0001");

    const gasLimit = await contract.vote.estimateGas(
      userAddress,
      marketId,
      voteYes,
      { value: voteCost }
    );

    const txResponse = await contract.vote(userAddress, marketId, voteYes, {
      value: voteCost,
      gasLimit: gasLimit,
    });

    console.log("Vote transaction sent:", txResponse.hash);

    // Record the vote in database
    const userVote = new UserVote({
      userAddress,
      marketId,
      vote: voteYes ? 'funny' : 'lame',
      transactionHash: txResponse.hash
    });
    await userVote.save();

    res.json({
      message: "Vote relayed successfully",
      transactionHash: txResponse.hash
    });
  } catch (error) {
    console.error("Error relaying vote:", error);
    res.status(500).json({ message: "Failed to relay vote", error: error.message });
  }
});

app.post("/api/memes", async (req, res) => {
  try {
    const meme = new Meme(req.body);
    await meme.save();
    res.status(201).json(meme);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.post("/api/meme", async (req, res) => {
  const { address, cid, templateId } = req.body;

  if (!address || cid === undefined) {
    return res.status(400).json({ message: "Missing required parameters" });
  }

  try {
    const contract = new Contract(contractAddress, contractABI, relayerWallet);

    const gasLimit = await contract.createMeme.estimateGas(
      address,
      cid,
      templateId
    );

    const txResponse = await contract.createMeme(address, cid, templateId, {
      gasLimit: gasLimit,
    });

    console.log("Meme creation transaction sent:", txResponse.hash);

    res.json({
      message: "Meme created successfully",
      transactionHash: txResponse.hash
    });
  } catch (error) {
    console.error("Error creating meme:", error);
    res.status(500).json({ message: "Failed to create meme", error: error.message });
  }
});

app.get("/api/memes", async (req, res) => {
  try {
    const memes = await Meme.find().sort({ createdAt: -1 });
    res.json(memes);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/memes/:templateId", async (req, res) => {
  try {
    const { templateId } = req.params;
    const memes = await Meme.find({ memeTemplate: templateId });

    if (memes.length === 0) {
      return res.status(404).json({ message: "No memes found for this template" });
    }

    res.json(memes);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/faucet/:address", async (req, res) => {
  try {
    const gas = await GasModel.findOne({ address: req.params.address });

    if (!gas) {
      const tx = await relayerWallet.sendTransaction({
        to: req.params.address,
        value: parseEther("0.1"),
      });

      await tx.wait();

      const sentGas = new GasModel({
        address: req.params.address,
      });

      await sentGas.save();
      return res.status(200).json({ message: "Sent tokens" });
    }

    res.status(200).json({ message: "Already given some testnet tokens" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`⚡ Auto-Settlement Service active`);
  console.log(`🔗 Contract: ${contractAddress}`);
});