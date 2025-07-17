import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY_OWNER;
const NEON_RPC = process.env.NEON_RPC || "https://devnet.neonevm.org";

if (!PRIVATE_KEY) {
  console.error("❌ Missing PRIVATE_KEY_OWNER in .env");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(NEON_RPC, {
  name: "neondevnet",
  chainId: 245022926,
});

const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

async function checkWalletSetup() {
  console.log("🔍 CHECKING YOUR CURRENT WALLET SETUP");
  console.log("=".repeat(50));

  try {
    // Check Neon EVM wallet
    console.log("1. ✅ Neon EVM Wallet Setup:");
    console.log(`   Address: ${wallet.address}`);

    const balance = await provider.getBalance(wallet.address);
    console.log(`   NEON Balance: ${ethers.formatEther(balance)} NEON`);

    const blockNumber = await provider.getBlockNumber();
    console.log(`   Connected to block: ${blockNumber}`);

    // Check if this is the same as a Solana wallet
    console.log("\n2. 🔗 Solana Relationship:");
    console.log(
      "   Your Neon EVM wallet automatically has a corresponding Solana address"
    );
    console.log("   This is handled internally by Neon EVM");
    console.log(
      "   You DON'T need to set up Phantom/Solana wallet for MemeLaunchpad"
    );

    console.log("\n3. 📋 What You Need vs What You Have:");
    console.log("   ✅ Neon EVM private key - YOU HAVE THIS");
    console.log("   ✅ MemeLaunchpad contract address - YOU HAVE THIS");
    console.log("   ✅ WSOL tokens - CHECK NEEDED");
    console.log("   ❓ Solana/Phantom wallet - NOT NEEDED for MemeLaunchpad");

    console.log("\n4. 🎯 Next Steps:");
    console.log("   1. Check WSOL balance: node bot/wsol-setup.js");
    console.log("   2. Debug token purchase: node bot/debug-buy.js");
    console.log(
      "   3. If needed, get WSOL from faucet: https://neonfaucet.org/"
    );

    console.log("\n5. 🤔 When Would You Need Solana Wallet?");
    console.log("   - Direct Solana program interactions");
    console.log("   - Anchor framework development");
    console.log("   - Direct Raydium operations (not through MemeLaunchpad)");
    console.log("   - Advanced Solana development");
  } catch (error) {
    console.error("❌ Error checking wallet:", error);
  }
}

checkWalletSetup();
