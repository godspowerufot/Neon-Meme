import { ethers } from "ethers";
import * as dotenv from "dotenv";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Keypair, Connection, PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

dotenv.config();

const NEON_RPC = process.env.NEON_RPC || "https://devnet.neonevm.org";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const PRIVATE_KEY = process.env.PRIVATE_KEY_OWNER;

const PRIVATE_KEY_SOLANA = process.env.PRIVATE_KEY_SOLANA;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ABI_PATH = path.join(__dirname, "MemeLaunchpad.json");
const ABI = JSON.parse(readFileSync(ABI_PATH, "utf8")).abi;

const provider = new ethers.JsonRpcProvider(NEON_RPC, {
  name: "neondevnet",
  chainId: 245022926,
});

const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);

function formatValue(value, decimals = 18) {
  return ethers.formatUnits(value, decimals);
}

async function checkWSOLBalance() {
  try {
    console.log("🔍 CHECKING WSOL BALANCE AND SETUP");
    console.log("=".repeat(50));

    // Get WSOL contract address
    const wsolAddress = await contract.wsolToken();
    console.log(`WSOL Contract: ${wsolAddress}`);

    // Create WSOL contract instance
    const wsolContract = new ethers.Contract(
      wsolAddress,
      [
        "function balanceOf(address) view returns (uint256)",
        "function allowance(address,address) view returns (uint256)",
        "function approve(address,uint256) returns (bool)",
        "function decimals() view returns (uint8)",
        "function symbol() view returns (string)",
        "function name() view returns (string)",
      ],
      provider
    );

    // Get WSOL info
    const name = await wsolContract.name();
    const symbol = await wsolContract.symbol();
    const decimals = await wsolContract.decimals();

    console.log(`Name: ${name}`);
    console.log(`Symbol: ${symbol}`);
    console.log(`Decimals: ${decimals}`);

    // Check wallet balance
    const balance = await wsolContract.balanceOf(wallet.address);
    console.log(`\nWallet: ${wallet.address}`);
    console.log(`WSOL Balance: ${formatValue(balance, decimals)} ${symbol}`);

    // Check allowance
    const allowance = await wsolContract.allowance(
      wallet.address,
      CONTRACT_ADDRESS
    );
    console.log(
      `Allowance for MemeLaunchpad: ${formatValue(
        allowance,
        decimals
      )} ${symbol}`
    );

    // Check NEON balance
    const neonBalance = await provider.getBalance(wallet.address);
    console.log(`NEON Balance: ${formatValue(neonBalance)} NEON`);

    if (balance <= 0) {
      console.log("\n❌ You have no WSOL tokens!");
      console.log("💡 To get WSOL tokens on Neon devnet:");
      console.log("1. Go to https://neonfaucet.org/");
      console.log("2. Enter your wallet address");
      console.log("3. Request WSOL tokens");
      console.log("4. Wait for the transaction to confirm");
    } else {
      console.log("\n✅ You have WSOL tokens!");
    }

    return {
      balance: formatValue(balance, decimals),
      allowance: formatValue(allowance, decimals),
      decimals,
    };
  } catch (error) {
    console.error("❌ Error checking WSOL balance:", error);
  }
}

async function approveWSL() {
  try {
    console.log("\n🔧 APPROVING WSOL FOR MEME LAUNCHPAD");
    console.log("=".repeat(50));

    const wsolAddress = await contract.wsolToken();
    const wsolContract = new ethers.Contract(
      wsolAddress,
      [
        "function approve(address,uint256) returns (bool)",
        "function allowance(address,address) view returns (uint256)",
      ],
      wallet
    );

    console.log("Approving maximum amount...");
    const tx = await wsolContract.approve(CONTRACT_ADDRESS, ethers.MaxUint256);
    console.log(`Transaction hash: ${tx.hash}`);

    await tx.wait();
    console.log("✅ WSOL approved!");

    // Check new allowance
    const newAllowance = await wsolContract.allowance(
      wallet.address,
      CONTRACT_ADDRESS
    );
    console.log(`New allowance: ${formatValue(newAllowance, 9)} WSOL`);
    // Check WSOL balance on Solana
    if (PRIVATE_KEY_SOLANA) {
      console.log("\n🔍 Checking WSOL balance on Solana wallet...");
      try {
        // Decode base58 private key
        const secretKey = Uint8Array.from(
          PRIVATE_KEY_SOLANA.match(/.{1,2}/g).map((b) => parseInt(b, 16))
        );
        const solanaKeypair = Keypair.fromSecretKey(secretKey);
        const solanaAddress = solanaKeypair.publicKey;
        console.log(`Solana Address: ${solanaAddress.toBase58()}`);

        // Connect to Solana devnet
        const solanaConnection = new Connection(
          "https://api.devnet.solana.com"
        );
        // WSOL mint address
        const WSOL_MINT = new PublicKey(
          "So11111111111111111111111111111111111111112"
        );
        // Get associated token address
        const ata = await getAssociatedTokenAddress(WSOL_MINT, solanaAddress);
        // Try to get account info
        let wsolAccountInfo;
        try {
          wsolAccountInfo = await getAccount(
            solanaConnection,
            ata,
            "confirmed",
            TOKEN_PROGRAM_ID
          );
        } catch (e) {
          console.log("No WSOL account found for this Solana address.");
        }
        if (wsolAccountInfo) {
          const wsolBalance = Number(wsolAccountInfo.amount) / Math.pow(10, 9);
          console.log(`WSOL Balance (Solana): ${wsolBalance} WSOL`);
        }
      } catch (e) {
        console.log("Error checking Solana WSOL balance:", e.message);
      }
    }
  } catch (error) {
    console.error("❌ Error approving WSOL:", error);
  }
}

// Run the checks
checkWSOLBalance().then((result) => {
  if (result && result.balance > 0 && result.allowance == 0) {
    console.log(
      "\n💡 You have WSOL but no allowance. Would you like to approve?"
    );
    console.log("Run: node wsol-setup.js approve");
  }
});

// Handle command line arguments
const args = process.argv.slice(2);
if (args[0] === "approve") {
  approveWSL();
}
