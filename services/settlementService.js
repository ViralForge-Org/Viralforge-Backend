// server/services/settlementService.js
const cron = require('node-cron');
const { ethers, Contract } = require('ethers');
const { SettlementRecord } = require('../models/Settlement');
const CONTRACT = require('../FunnyOrFud.json');

class AutoSettlementService {
    constructor() {
        this.provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
        this.relayerWallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
        this.contractAddress = "0xbCD7cd28A214772A8E785E1f2E0ca19f01FdCEf4";
        this.contract = new Contract(this.contractAddress, CONTRACT.abi, this.relayerWallet);
        this.isRunning = false;
    }

    // Start the automatic settlement service
    start() {
        console.log('🚀 Starting Auto-Settlement Service...');
        
        // Check every 5 minutes for settlements
        cron.schedule('*/5 * * * *', async () => {
            if (this.isRunning) {
                console.log('⏳ Settlement check already in progress, skipping...');
                return;
            }
            
            this.isRunning = true;
            try {
                await this.checkAndSettleMarkets();
            } catch (error) {
                console.error('🚨 Auto-settlement error:', error);
            } finally {
                this.isRunning = false;
            }
        });

        console.log('✅ Auto-Settlement Service started successfully');
    }

    // Main settlement logic
    async checkAndSettleMarkets() {
        console.log('🔍 Checking for markets to settle...');

        try {
            const marketCount = await this.contract.marketCount();
            console.log(`📊 Total markets: ${marketCount}`);

            // If no markets exist yet, skip settlement
            if (marketCount === 0n || marketCount === 0) {
                console.log('📝 No markets found, skipping settlement check');
                return;
            }

            let settledCount = 0;

            for (let i = 0; i < marketCount; i++) {
                try {
                    const market = await this.contract.getMarket(i);
                    const [creator, endTime, yesVotes, noVotes, totalStaked, isActive, metadata, memes] = market;
                    
                    // Skip if already settled
                    if (!isActive) {
                        continue;
                    }
                    
                    const now = Math.floor(Date.now() / 1000);
                    const timeLeft = Number(endTime) - now;
                    
                    // Check if 6 hours have passed
                    if (timeLeft <= 0) {
                        console.log(`⚡ Settling market ${i} (${timeLeft}s overdue)...`);
                        
                        const settled = await this.settleMarket(i, market);
                        if (settled) {
                            settledCount++;
                        }
                    } else {
                        console.log(`⏰ Market ${i}: ${Math.floor(timeLeft / 3600)}h ${Math.floor((timeLeft % 3600) / 60)}m remaining`);
                    }
                    
                } catch (error) {
                    console.error(`❌ Error processing market ${i}:`, error.message);
                }
            }
            
            if (settledCount > 0) {
                console.log(`🎉 Successfully settled ${settledCount} markets`);
            } else {
                console.log('✨ No markets ready for settlement');
            }
            
        } catch (error) {
            console.error('🚨 Failed to check markets:', error);
        }
    }

    // Settle individual market
    async settleMarket(marketId, marketData) {
        try {
            const [creator, endTime, yesVotes, noVotes, totalStaked, isActive, metadata, memes] = marketData;
            
            console.log(`📈 Market ${marketId} Stats:`, {
                yesVotes: Number(yesVotes),
                noVotes: Number(noVotes),
                totalStaked: ethers.formatEther(totalStaked),
                creator: creator.slice(0, 8) + '...'
            });
            
            // Estimate gas first
            const gasEstimate = await this.contract.releaseRewards.estimateGas(marketId);
            console.log(`⛽ Estimated gas: ${gasEstimate}`);
            
            // Execute settlement
            const tx = await this.contract.releaseRewards(marketId, {
                gasLimit: gasEstimate * BigInt(120) / BigInt(100) // Add 20% buffer
            });
            
            console.log(`📤 Settlement transaction sent: ${tx.hash}`);
            
            // Wait for confirmation
            const receipt = await tx.wait();
            console.log(`✅ Market ${marketId} settled successfully! Block: ${receipt.blockNumber}`);
            
            // Store settlement record
            await this.storeSettlementRecord(marketId, marketData, tx.hash, receipt);
            
            return true;
            
        } catch (error) {
            console.error(`🚨 Failed to settle market ${marketId}:`, error.message);
            
            // Log specific error types
            if (error.message.includes('Market is still active')) {
                console.log(`⏰ Market ${marketId} not ready yet`);
            } else if (error.message.includes('Market is not active')) {
                console.log(`✨ Market ${marketId} already settled`);
            } else if (error.message.includes('insufficient funds')) {
                console.error('💸 Insufficient funds for settlement gas!');
            }
            
            return false;
        }
    }

    // Store settlement record in database
    async storeSettlementRecord(marketId, marketData, txHash, receipt) {
        try {
            const [creator, endTime, yesVotes, noVotes, totalStaked, isActive, metadata, memes] = marketData;
            
            const totalVotes = Number(yesVotes) + Number(noVotes);
            const winnerSide = Number(yesVotes) > Number(noVotes) ? 'funny' : 'lame';
            const totalPool = Number(totalStaked);
            const creatorReward = Math.floor(totalPool * 0.05);
            const voterRewards = totalPool - creatorReward;
            
            const settlementRecord = new SettlementRecord({
                marketId,
                templateCreator: creator,
                endTime: new Date(Number(endTime) * 1000),
                totalVotes,
                yesVotes: Number(yesVotes),
                noVotes: Number(noVotes),
                totalStaked: totalStaked.toString(),
                winnerSide,
                creatorReward: creatorReward.toString(),
                voterRewards: voterRewards.toString(),
                settlementTx: txHash,
                blockNumber: receipt.blockNumber,
                gasUsed: receipt.gasUsed.toString(),
                settledAt: new Date()
            });
            
            await settlementRecord.save();
            console.log(`💾 Settlement record saved for market ${marketId}`);
            
        } catch (error) {
            console.error(`🚨 Failed to store settlement record for market ${marketId}:`, error);
        }
    }

    // Manual settlement trigger (for admin use)
    async manualSettle(marketId) {
        console.log(`🔧 Manual settlement requested for market ${marketId}`);
        
        try {
            const market = await this.contract.getMarket(marketId);
            return await this.settleMarket(marketId, market);
        } catch (error) {
            console.error(`🚨 Manual settlement failed for market ${marketId}:`, error);
            throw error;
        }
    }

    // Get settlement status
    async getSettlementStatus(marketId) {
        try {
            const market = await this.contract.getMarket(marketId);
            const [creator, endTime, yesVotes, noVotes, totalStaked, isActive, metadata] = market;
            
            const now = Math.floor(Date.now() / 1000);
            const timeLeft = Number(endTime) - now;
            
            return {
                marketId,
                isActive,
                timeLeft,
                readyForSettlement: timeLeft <= 0 && isActive,
                yesVotes: Number(yesVotes),
                noVotes: Number(noVotes),
                totalStaked: ethers.formatEther(totalStaked)
            };
        } catch (error) {
            console.error(`Error getting settlement status for market ${marketId}:`, error);
            throw error;
        }
    }
}

module.exports = AutoSettlementService;