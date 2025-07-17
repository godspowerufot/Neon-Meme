import { ethers } from "ethers";
import * as dotenv from "dotenv";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline";

dotenv.config();

const NEON_RPC = process.env.NEON_RPC || "https://devnet.neonevm.org";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const PRIVATE_KEY = process.env.PRIVATE_KEY_OWNER;

if (!CONTRACT_ADDRESS) {
  console.error("❌ Missing CONTRACT_ADDRESS in .env");
  process.exit(1);
}

if (!PRIVATE_KEY) {
  console.error("❌ Missing PRIVATE_KEY_OWNER in .env");
  process.exit(1);
}

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
const contractWithSigner = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

function formatValue(value, decimals = 18) {
  return ethers.formatUnits(value, decimals);
}

function parseValue(value, decimals = 18) {
  return ethers.parseUnits(value.toString(), decimals);
}

class InteractiveBot {
  async start() {
    console.log("🔗 Connecting to Neon...");
    const blockNumber = await provider.getBlockNumber();
    console.log("✅ Current Neon Block:", blockNumber);
    console.log("✅ Wallet Address:", wallet.address);
    console.log("✅ Contract Address:", CONTRACT_ADDRESS);

    await this.showMainMenu();
  }

  async showMainMenu() {
    while (true) {
      console.log("\n" + "=".repeat(50));
      console.log("🚀 MEME LAUNCHPAD INTERACTIVE BOT");
      console.log("=".repeat(50));
      console.log("1. Get Contract Info");
      console.log("2. Get Token Info");
      console.log("3. Calculate Buy Amount");
      console.log("4. Create Token Sale");
      console.log("5. Buy Tokens");
      console.log("6. Claim Token Sale Fee (Owner)");
      console.log("7. Set Fee Percent (Owner)");
      console.log("8. Exit");
      console.log("=".repeat(50));

      const choice = await question("Choose an option (1-8): ");

      try {
        switch (choice) {
          case "1":
            await this.getContractInfo();
            break;
          case "2":
            await this.getTokenInfo();
            break;
          case "3":
            await this.calculateBuyAmount();
            break;
          case "4":
            await this.createTokenSale();
            break;
          case "5":
            await this.buyTokens();
            break;
          case "6":
            await this.claimTokenSaleFee();
            break;
          case "7":
            await this.setFeePercent();
            break;
          case "8":
            console.log("👋 Goodbye!");
            rl.close();
            return;
          default:
            console.log("❌ Invalid choice. Please try again.");
        }
      } catch (error) {
        console.error("❌ Error:", error.message);
      }

      await question("\nPress Enter to continue...");
    }
  }

  async getContractInfo() {
    console.log("📋 Getting contract information...");

    const [
      owner,
      feePercent,
      fee,
      feeDenominator,
      wsolToken,
      bondingCurve,
      erc20Factory,
      payer,
    ] = await Promise.all([
      contract.owner(),
      contract.feePercent(),
      contract.fee(),
      contract.FEE_DENOMINATOR(),
      contract.wsolToken(),
      contract.bondingCurve(),
      contract.erc20ForSplFactory(),
      contract.getPayer(),
    ]);

    console.log("📌 Contract Info:");
    console.log(`   Owner: ${owner}`);
    console.log(
      `   Fee Percent: ${feePercent}/${feeDenominator} (${(
        (Number(feePercent) / Number(feeDenominator)) *
        100
      ).toFixed(2)}%)`
    );
    console.log(`   Accumulated Fee: ${formatValue(fee, 9)} WSOL`);
    console.log(`   WSOL Token: ${wsolToken}`);
    console.log(`   Bonding Curve: ${bondingCurve}`);
    console.log(`   ERC20 Factory: ${erc20Factory}`);
    console.log(`   Payer: ${ethers.encodeBase58(payer)}`);
  }

  async getTokenInfo() {
    const tokenAddress = await question("Enter token address: ");

    console.log(`📋 Getting token info for: ${tokenAddress}`);

    const tokenInfo = await contract.tokens(tokenAddress);
    const neonAddress = await contract.getNeonAddress(tokenAddress);

    const tokenStates = ["NOT_CREATED", "FUNDING", "TRADING"];

    console.log("📌 Token Info:");
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
    console.log(`   State: ${tokenStates[tokenInfo.state]}`);
    console.log(`   Neon Address: ${ethers.encodeBase58(neonAddress)}`);
  }

  async calculateBuyAmount() {
    const tokenAddress = await question("Enter token address: ");
    const wsolAmount = await question("Enter WSOL amount: ");

    console.log(`📋 Calculating buy amount for ${wsolAmount} WSOL...`);

    const amountInWei = parseValue(wsolAmount, 9);
    const result = await contract.calculateBuyAmount(tokenAddress, amountInWei);

    console.log("📌 Buy Calculation:");
    console.log(`   WSOL Amount: ${wsolAmount} WSOL`);
    console.log(
      `   Tokens to receive: ${formatValue(result.receiveAmount, 9)} tokens`
    );
    console.log(
      `   Available supply: ${formatValue(result.availableSupply, 9)} tokens`
    );
    console.log(
      `   Total supply: ${formatValue(result.totalSupply, 9)} tokens`
    );
    console.log(
      `   Contribution (after fee): ${formatValue(
        result.contributionWithoutFee,
        9
      )} WSOL`
    );
  }

  async createTokenSale() {
    console.log("🚀 Creating a new token sale...");

    const name = await question("Enter token name: ");
    const symbol = await question("Enter token symbol: ");
    const decimals =
      (await question("Enter token decimals (default 9): ")) || "9";
    const fundingGoal = await question("Enter funding goal (in WSOL): ");
    const initialSupply = await question("Enter initial supply (tokens): ");
    const fundingSupply = await question("Enter funding supply (tokens): ");

    console.log(`🚀 Creating token sale: ${name} (${symbol})`);

    const tx = await contractWithSigner.createTokenSale(
      name,
      symbol,
      parseInt(decimals),
      parseValue(fundingGoal, 9),
      parseValue(initialSupply, 9),
      parseValue(fundingSupply, 9)
    );

    console.log(`📝 Transaction submitted: ${tx.hash}`);
    console.log("⏳ Waiting for confirmation...");

    const receipt = await tx.wait();
    console.log("✅ Token sale created successfully!");

    // Get token address from events
    const tokenCreatedEvent = receipt.logs.find((log) => {
      try {
        const parsed = contract.interface.parseLog(log);
        return parsed.name === "TokenSaleCreated";
      } catch {
        return false;
      }
    });

    if (tokenCreatedEvent) {
      const parsed = contract.interface.parseLog(tokenCreatedEvent);
      const tokenAddress = parsed.args.token;
      console.log(`📌 Token Address: ${tokenAddress}`);
    }
  }

  async buyTokens() {
    const tokenAddress = await question("Enter token address: ");
    const wsolAmount = await question("Enter WSOL amount to spend: ");

    console.log(`💰 Buying tokens from: ${tokenAddress}`);
    console.log(`💰 Amount: ${wsolAmount} WSOL`);

    const amountInWei = parseValue(wsolAmount, 9);

    // Check if we need to approve WSOL first
    const wsolContract = new ethers.Contract(
      await contract.wsolToken(),
      [
        "function allowance(address,address) view returns (uint256)",
        "function approve(address,uint256) returns (bool)",
      ],
      wallet
    );

    const allowance = await wsolContract.allowance(
      wallet.address,
      CONTRACT_ADDRESS
    );
    if (allowance < amountInWei) {
      console.log("⏳ Approving WSOL...");
      const approveTx = await wsolContract.approve(
        CONTRACT_ADDRESS,
        ethers.MaxUint256
      );
      await approveTx.wait();
      console.log("✅ WSOL approved!");
    }

    const tx = await contractWithSigner.buy(tokenAddress, amountInWei);

    console.log(`📝 Transaction submitted: ${tx.hash}`);
    console.log("⏳ Waiting for confirmation...");

    const receipt = await tx.wait();
    console.log("✅ Tokens purchased successfully!");

    // Check for liquidity added event
    const liquidityEvent = receipt.logs.find((log) => {
      try {
        const parsed = contract.interface.parseLog(log);
        return parsed.name === "TokenLiqudityAdded";
      } catch {
        return false;
      }
    });

    if (liquidityEvent) {
      const parsed = contract.interface.parseLog(liquidityEvent);
      console.log("🎉 Funding goal reached! Raydium pool created:");
      console.log(`   Pool ID: ${ethers.encodeBase58(parsed.args.poolId)}`);
      console.log(`   LP Amount: ${formatValue(parsed.args.lpAmount, 9)}`);
      console.log(
        `   LP Lock NFT: ${ethers.encodeBase58(
          parsed.args.lpLockPositionNFTAccount
        )}`
      );
    }
  }

  async claimTokenSaleFee() {
    console.log("💰 Claiming token sale fee...");

    try {
      // Check if current wallet is the owner
      const owner = await contract.owner();
      if (wallet.address.toLowerCase() !== owner.toLowerCase()) {
        console.log("❌ Error: Only the contract owner can claim fees");
        console.log(`   Contract owner: ${owner}`);
        console.log(`   Current wallet: ${wallet.address}`);
        return;
      }

      // Check accumulated fees
      const fee = await contract.fee();
      if (fee === 0n) {
        console.log("❌ Error: No fees to claim (accumulated fee is 0)");
        return;
      }

      console.log(`💰 Accumulated fees: ${formatValue(fee, 9)} WSOL`);

      // Try to estimate gas first
      const gasEstimate =
        await contractWithSigner.claimTokenSaleFee.estimateGas();
      console.log(`⛽ Estimated gas: ${gasEstimate.toString()}`);

      const tx = await contractWithSigner.claimTokenSaleFee();

      console.log(`📝 Transaction submitted: ${tx.hash}`);
      console.log("⏳ Waiting for confirmation...");

      const receipt = await tx.wait();
      console.log("✅ Token sale fee claimed successfully!");
    } catch (error) {
      console.error("❌ Error claiming fees:", error.message);

      // Try to decode the custom error
      if (error.data) {
        try {
          const decodedError = contract.interface.parseError(error.data);
          console.log(`❌ Custom error: ${decodedError.name}`);
          if (decodedError.args) {
            console.log(`   Args:`, decodedError.args);
          }
        } catch (decodeError) {
          console.log("❌ Could not decode custom error");
        }
      }
    }
  }

  async setFeePercent() {
    const newFeePercent = await question(
      "Enter new fee percent (in basis points, e.g., 100 = 1%): "
    );

    console.log(`⚙️ Setting fee percent to: ${newFeePercent} basis points`);

    const tx = await contractWithSigner.setFeePercent(parseInt(newFeePercent));

    console.log(`📝 Transaction submitted: ${tx.hash}`);
    console.log("⏳ Waiting for confirmation...");

    const receipt = await tx.wait();
    console.log("✅ Fee percent updated successfully!");
  }
}

async function main() {
  try {
    const bot = new InteractiveBot();
    await bot.start();
  } catch (error) {
    console.error("❌ Error in main:", error);
    rl.close();
  }
}

main();
