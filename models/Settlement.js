// server/models/Settlement.js
const mongoose = require("mongoose");

// Settlement Record Schema
const settlementSchema = new mongoose.Schema({
  marketId: {
    type: Number,
    required: true,
    unique: true
  },
  templateCreator: {
    type: String,
    required: true
  },
  endTime: {
    type: Date,
    required: true
  },
  totalVotes: {
    type: Number,
    required: true
  },
  yesVotes: {
    type: Number,
    required: true
  },
  noVotes: {
    type: Number,
    required: true
  },
  totalStaked: {
    type: String, // Store as string to handle big numbers
    required: true
  },
  winnerSide: {
    type: String,
    enum: ['funny', 'lame'],
    required: true
  },
  creatorReward: {
    type: String,
    required: true
  },
  voterRewards: {
    type: String,
    required: true
  },
  settlementTx: {
    type: String,
    required: true
  },
  blockNumber: {
    type: Number,
    required: true
  },
  gasUsed: {
    type: String,
    required: true
  },
  settledAt: {
    type: Date,
    default: Date.now
  },
  // Track individual user participations
  participants: [{
    address: {
      type: String,
      required: true
    },
    vote: {
      type: String,
      enum: ['funny', 'lame'],
      required: true
    },
    staked: {
      type: String,
      default: "100000000000000" // 0.0001 ETH in wei
    },
    payout: {
      type: String,
      default: "0"
    },
    won: {
      type: Boolean,
      required: true
    }
  }]
}, {
  timestamps: true
});

// User Vote Tracking Schema
const userVoteSchema = new mongoose.Schema({
  userAddress: {
    type: String,
    required: true
  },
  marketId: {
    type: Number,
    required: true
  },
  vote: {
    type: String,
    enum: ['funny', 'lame'],
    required: true
  },
  stakeAmount: {
    type: String,
    default: "100000000000000" // 0.0001 ETH in wei
  },
  transactionHash: String,
  votedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Compound index for efficient queries
userVoteSchema.index({ userAddress: 1, marketId: 1 }, { unique: true });
settlementSchema.index({ marketId: 1 });
settlementSchema.index({ settledAt: -1 });

const SettlementRecord = mongoose.model("SettlementRecord", settlementSchema);
const UserVote = mongoose.model("UserVote", userVoteSchema);

module.exports = { SettlementRecord, UserVote };