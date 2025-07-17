import { ethers } from "ethers";
import * as dotenv from "dotenv";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const NEON_RPC = process.env.NEON_RPC || "https://devnet.neonevm.org";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const PRIVATE_KEY = process.env.PRIVATE_KEY_OWNER;

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

function parseValue(value, decimals = 18) {
  return ethers.parseUnits(value.toString(), decimals);
}

async function debugTokenPurchase(tokenAddress, wsolAmount) {
  console.log("🔍 DEBUGGING TOKEN PURCHASE");
  console.log("=".repeat(50));

  try {
    // 1. Check basic connection
    console.log("1. ✅ Checking connection...");
    const blockNumber = await provider.getBlockNumber();
    console.log(`   Block number: ${blockNumber}`);
    console.log(`   Wallet: ${wallet.address}`);
    console.log(`   Contract: ${CONTRACT_ADDRESS}`);

    // 2. Check token exists and state
    console.log("\n2. 🔍 Checking token state...");
    const tokenInfo = await contract.tokens(tokenAddress);
    const tokenStates = ["NOT_CREATED", "FUNDING", "TRADING"];

    console.log(`   Token Address: ${tokenAddress}`);
    console.log(
      `   Funding Goal: ${formatValue(tokenInfo.fundingGoal, 9)} WSOL`
    );
    console.log(
      `   Initial Supply: ${formatValue(tokenInfo.initialSupply, 9)} tokens`
    );
    console.log(
      `   Funding Supply: ${formatValue(tokenInfo.fundingSupply, 9)} tokens`
    );
    console.log(
      `   Collateral Amount: ${formatValue(tokenInfo.collateralAmount, 9)} WSOL`
    );
    console.log(
      `   State: ${tokenStates[tokenInfo.state]} (${tokenInfo.state})`
    );

    if (tokenInfo.state !== 1) {
      console.log(`   ❌ ERROR: Token is not in FUNDING state!`);
      return;
    }

    // 3. Check amount
    console.log("\n3. 💰 Checking amount...");
    const amountInWei = parseValue(wsolAmount, 9);
    console.log(`   Amount: ${wsolAmount} WSOL`);
    console.log(`   Amount in wei: ${amountInWei}`);

    if (amountInWei <= 0) {
      console.log(`   ❌ ERROR: Amount must be greater than 0!`);
      return;
    }

    // 4. Check wallet NEON balance
    console.log("\n4. 💼 Checking wallet balance...");
    const neonBalance = await provider.getBalance(wallet.address);
    console.log(`   NEON balance: ${formatValue(neonBalance)} NEON`);

    // 5. Check WSOL setup
    console.log("\n5. 🪙 Checking WSOL setup...");
    const wsolAddress = await contract.wsolToken();
    console.log(`   WSOL contract: ${wsolAddress}`);

    const wsolContract = new ethers.Contract(
      wsolAddress,
      [
        "function balanceOf(address) view returns (uint256)",
        "function allowance(address,address) view returns (uint256)",
        "function decimals() view returns (uint8)",
        "function symbol() view returns (string)",
      ],
      provider
    );

    const wsolBalance = await wsolContract.balanceOf(wallet.address);
    const wsolAllowance = await wsolContract.allowance(
      wallet.address,
      CONTRACT_ADDRESS
    );
    const wsolDecimals = await wsolContract.decimals();
    const wsolSymbol = await wsolContract.symbol();

    console.log(`   WSOL symbol: ${wsolSymbol}`);
    console.log(`   WSOL decimals: ${wsolDecimals}`);
    console.log(`   WSOL balance: ${formatValue(wsolBalance, 9)} WSOL`);
    console.log(`   WSOL allowance: ${formatValue(wsolAllowance, 9)} WSOL`);

    if (wsolBalance < amountInWei) {
      console.log(`   ❌ ERROR: Insufficient WSOL balance!`);
      console.log(`   Required: ${wsolAmount} WSOL`);
      console.log(`   Available: ${formatValue(wsolBalance, 9)} WSOL`);
      return;
    }

    // 6. Check contract state
    console.log("\n6. 📋 Checking contract state...");
    const owner = await contract.owner();
    const feePercent = await contract.feePercent();
    const fee = await contract.fee();

    console.log(`   Owner: ${owner}`);
    console.log(`   Fee percent: ${feePercent}`);
    console.log(`   Accumulated fee: ${formatValue(fee, 9)} WSOL`);

    // 7. Test calculateBuyAmount
    console.log("\n7. 🧮 Testing calculateBuyAmount...");
    try {
      const calculation = await contract.calculateBuyAmount(
        tokenAddress,
        amountInWei
      );
      console.log(`   ✅ Calculation successful:`);
      console.log(
        `   Tokens to receive: ${formatValue(calculation.receiveAmount, 9)}`
      );
      console.log(
        `   Available supply: ${formatValue(calculation.availableSupply, 9)}`
      );
      console.log(
        `   Total supply: ${formatValue(calculation.totalSupply, 9)}`
      );
      console.log(
        `   Contribution (after fee): ${formatValue(
          calculation.contributionWithoutFee,
          9
        )}`
      );
    } catch (calcError) {
      console.log(`   ❌ Calculate buy amount failed:`, calcError.message);
      return;
    }

    // 8. Test gas estimation
    console.log("\n8. ⛽ Testing gas estimation...");
    const contractWithSigner = new ethers.Contract(
      CONTRACT_ADDRESS,
      ABI,
      wallet
    );

    try {
      const gasEstimate = await contractWithSigner.buy.estimateGas(
        tokenAddress,
        amountInWei
      );
      console.log(`   ✅ Gas estimation successful: ${gasEstimate}`);
    } catch (gasError) {
      console.log(`   ❌ Gas estimation failed:`, gasError.message);

      // Try to decode the error
      if (gasError.data) {
        console.log(`   Error data: ${gasError.data}`);

        // Common error codes
        const errorCodes = {
          "0xe450d38c": "InvalidTokenSale()",
          "0x340dabef": "InvalidInputAmount()",
          "0x9ebda18b": "InvalidTokenSale()",
          "0xa0fa7c8f": "InvalidTokenSaleFee()",
          "0x3ee5aeb5": "ReentrancyGuardReentrantCall()",
        };

        const errorCode = gasError.data.slice(0, 10);
        const errorName = errorCodes[errorCode];

        if (errorName) {
          console.log(`   ❌ Decoded error: ${errorName}`);
        } else {
          console.log(`   ❌ Unknown error code: ${errorCode}`);
        }
      }

      return;
    }

    console.log("\n✅ All checks passed! Transaction should work.");
  } catch (error) {
    console.error("❌ Debug error:", error);
  }
}

// Usage - replace with your actual token address
const TOKEN_ADDRESS = "0x835209d598c84d8e324d7374e690751bf28ac3ad"; // Replace with actual token address
const WSOL_AMOUNT = "1"; // 1 WSOL

debugTokenPurchase(TOKEN_ADDRESS, WSOL_AMOUNT);
