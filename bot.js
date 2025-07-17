import TelegramBot from "node-telegram-bot-api";
import { ethers } from "ethers";
import * as dotenv from "dotenv";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

// === ENV VARS ===
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const NEON_RPC = process.env.NEON_RPC || "https://devnet.neonevm.org";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const PRIVATE_KEY = process.env.PRIVATE_KEY_OWNER;

// === CHECK ENV ===
if (!TELEGRAM_BOT_TOKEN) {
  console.error("❌ Missing TELEGRAM_BOT_TOKEN in .env");
  process.exit(1);
}
if (!CONTRACT_ADDRESS) {
  console.error("❌ Missing CONTRACT_ADDRESS in .env");
  process.exit(1);
}
if (!PRIVATE_KEY) {
  console.error("❌ Missing PRIVATE_KEY_OWNER in .env");
  process.exit(1);
}

// === PATHS & ABI ===
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ABI_PATH = path.join(__dirname, "MemeLaunchpad.json");
const ABI = JSON.parse(readFileSync(ABI_PATH, "utf8")).abi;

// === Ethers Setup ===
const provider = new ethers.JsonRpcProvider(NEON_RPC, {
  name: "neondevnet",
  chainId: 245022926,
});
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
const contractWithSigner = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

// === EXPLORER URLS ===
const EXPLORER_TX_URL = "https://neon-devnet.blockscout.com/tx/";
const EXPLORER_ADDRESS_URL = "https://neon-devnet.blockscout.com/address/";

// === HELPER FUNCTIONS ===
const formatValue = (v, d = 9) => ethers.formatUnits(v, d);
const parseValue = (v, d = 9) => ethers.parseUnits(v.toString(), d);

// Helper function to create clickable links
const createTxLink = (hash) => `[${hash}](${EXPLORER_TX_URL}${hash})`;
const createAddressLink = (address) =>
  `[${address}](${EXPLORER_ADDRESS_URL}${address})`;

// === Create Telegram Bot ===
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// === USER SESSION STATE ===
const sessions = {};

// === MAIN KEYBOARD ===
const mainKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: "📊 Contract Info", callback_data: "contract_info" },
        { text: "🔍 Token Info", callback_data: "token_info" },
      ],
      [
        { text: "💰 Calculate Buy", callback_data: "calculate_buy" },
        { text: "🚀 Create Token Sale", callback_data: "create_token" },
      ],
      [
        { text: "🛒 Buy Tokens", callback_data: "buy_tokens" },
        { text: "💎 Claim Fees", callback_data: "claim_fees" },
      ],
      [
        { text: "⚙️ Set Fee %", callback_data: "set_fee" },
        { text: "🔧 Wallet Setup", callback_data: "wallet_setup" },
      ],
      [
        { text: "🩺 Debug Buy", callback_data: "debug_buy" },
        { text: "❓ Help", callback_data: "help" },
      ],
    ],
  },
};

// === START COMMAND ===
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const blockNumber = await provider.getBlockNumber();

  const welcomeMessage = `
🚀 *Meme Launchpad Bot*

✅ Connected to *Neon Devnet*
📍 Contract: \`${CONTRACT_ADDRESS}\`
👤 Wallet: \`${wallet.address}\`
⛓️ Current Block: ${blockNumber}

Choose an action below:
`;

  bot.sendMessage(chatId, welcomeMessage, {
    parse_mode: "Markdown",
    ...mainKeyboard,
  });
});

// === HELP COMMAND ===
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `
📖 *Help Menu*

• 📊 Contract Info → Shows contract details  
• 🔍 Token Info → Enter token address → Shows sale details  
• 💰 Calculate Buy → Enter token & WSOL → Estimate tokens  
• 🚀 Create Token Sale → Create a new memecoin  
• 🛒 Buy Tokens → Buy from an active sale  
• 💎 Claim Fees → Owner only  
• ⚙️ Set Fee % → Owner only  
• 🔧 Wallet Setup → Check NEON & WSOL balances  
• 🩺 Debug Buy → Diagnose purchase issues  

All amounts are WSOL (9 decimals).
    `,
    { parse_mode: "Markdown", ...mainKeyboard }
  );
});

// === CALLBACK HANDLER ===
bot.on("callback_query", async (cb) => {
  const chatId = cb.message.chat.id;
  const userId = cb.from.id;
  const action = cb.data;

  bot.answerCallbackQuery(cb.id);

  switch (action) {
    case "contract_info":
      return showContractInfo(chatId);

    case "token_info":
      sessions[userId] = { step: "token_info" };
      bot.sendMessage(chatId, "🔍 Please enter the token address:");
      break;

    case "calculate_buy":
      sessions[userId] = { step: "calc_token" };
      bot.sendMessage(chatId, "💰 Enter the token address to calculate:");
      break;

    case "create_token":
      sessions[userId] = { step: "create_name" };
      bot.sendMessage(chatId, "🚀 Enter token name:");
      break;

    case "buy_tokens":
      sessions[userId] = { step: "buy_token" };
      bot.sendMessage(chatId, "🛒 Enter token address:");
      break;

    case "claim_fees":
      return claimFees(chatId);

    case "set_fee":
      sessions[userId] = { step: "set_fee" };
      bot.sendMessage(chatId, "⚙️ Enter new fee percent (basis points):");
      break;

    case "wallet_setup":
      return checkWalletSetup(chatId);

    case "debug_buy":
      sessions[userId] = { step: "debug_token" };
      bot.sendMessage(chatId, "🩺 Enter token address to debug:");
      break;

    case "help":
      bot.sendMessage(chatId, "Type /help for full details.");
      break;
  }
});

// === TEXT MESSAGE HANDLER (STATE MACHINE) ===
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text?.trim();

  // Ignore commands like /start /help here
  if (!text || text.startsWith("/")) return;

  const session = sessions[userId];
  if (!session) {
    bot.sendMessage(chatId, "Please choose from the menu.", mainKeyboard);
    return;
  }

  try {
    // --- GET TOKEN INFO ---
    if (session.step === "token_info") {
      await showTokenInfo(chatId, text);
      delete sessions[userId];
    }

    // --- CALCULATE BUY ---
    else if (session.step === "calc_token") {
      session.token = text;
      session.step = "calc_amount";
      bot.sendMessage(chatId, "Enter WSOL amount:");
    } else if (session.step === "calc_amount") {
      if (!text || isNaN(parseFloat(text))) {
        bot.sendMessage(
          chatId,
          "❌ Please enter a valid number for WSOL amount:"
        );
        return;
      }
      await calculateBuy(chatId, session.token, text);
      delete sessions[userId];
    }

    // --- CREATE TOKEN SALE ---
    else if (session.step === "create_name") {
      if (!text) {
        bot.sendMessage(
          chatId,
          "❌ Token name cannot be empty. Please enter a name:"
        );
        return;
      }
      session.name = text;
      session.step = "create_symbol";
      bot.sendMessage(chatId, "Enter token symbol:");
    } else if (session.step === "create_symbol") {
      if (!text) {
        bot.sendMessage(
          chatId,
          "❌ Token symbol cannot be empty. Please enter a symbol:"
        );
        return;
      }
      session.symbol = text;
      session.step = "create_decimals";
      bot.sendMessage(chatId, "Enter token decimals (default 9):");
    } else if (session.step === "create_decimals") {
      session.decimals = text || "9";
      session.step = "create_goal";
      bot.sendMessage(chatId, "Enter funding goal (WSOL):");
    } else if (session.step === "create_goal") {
      if (!text || isNaN(parseFloat(text))) {
        bot.sendMessage(
          chatId,
          "❌ Please enter a valid number for funding goal:"
        );
        return;
      }
      session.goal = text;
      session.step = "create_init";
      bot.sendMessage(chatId, "Enter initial supply:");
    } else if (session.step === "create_init") {
      if (!text || isNaN(parseFloat(text))) {
        bot.sendMessage(
          chatId,
          "❌ Please enter a valid number for initial supply:"
        );
        return;
      }
      session.init = text;
      session.step = "create_fund";
      bot.sendMessage(chatId, "Enter funding supply:");
    } else if (session.step === "create_fund") {
      if (!text || isNaN(parseFloat(text))) {
        bot.sendMessage(
          chatId,
          "❌ Please enter a valid number for funding supply:"
        );
        return;
      }
      session.fund = text;
      await createTokenSale(chatId, session);
      delete sessions[userId];
    }

    // --- BUY TOKENS ---
    else if (session.step === "buy_token") {
      session.token = text;
      session.step = "buy_amount";
      bot.sendMessage(chatId, "Enter WSOL amount to spend:");
    } else if (session.step === "buy_amount") {
      if (!text || isNaN(parseFloat(text))) {
        bot.sendMessage(
          chatId,
          "❌ Please enter a valid number for WSOL amount:"
        );
        return;
      }
      await buyTokens(chatId, session.token, text);
      delete sessions[userId];
    }

    // --- SET FEE ---
    else if (session.step === "set_fee") {
      if (!text || isNaN(parseInt(text))) {
        bot.sendMessage(
          chatId,
          "❌ Please enter a valid number for fee basis points:"
        );
        return;
      }
      await setFee(chatId, text);
      delete sessions[userId];
    }

    // --- DEBUG BUY ---
    else if (session.step === "debug_token") {
      session.token = text;
      session.step = "debug_amount";
      bot.sendMessage(chatId, "Enter WSOL amount to debug:");
    } else if (session.step === "debug_amount") {
      if (!text || isNaN(parseFloat(text))) {
        bot.sendMessage(
          chatId,
          "❌ Please enter a valid number for WSOL amount:"
        );
        return;
      }
      await debugTokenPurchase(chatId, session.token, text);
      delete sessions[userId];
    }
  } catch (err) {
    console.error("Error in message handler:", err);
    bot.sendMessage(chatId, `❌ Error: ${err.message}`);
    delete sessions[userId];
  }
});

// === FUNCTIONS ===

async function showContractInfo(chatId) {
  bot.sendMessage(chatId, "📋 Fetching contract info...");
  const [owner, feePercent, fee, denom, wsol, bondingCurve, factory, payer] =
    await Promise.all([
      contract.owner(),
      contract.feePercent(),
      contract.fee(),
      contract.FEE_DENOMINATOR(),
      contract.wsolToken(),
      contract.bondingCurve(),
      contract.erc20ForSplFactory(),
      contract.getPayer(),
    ]);

  const percent = ((Number(feePercent) / Number(denom)) * 100).toFixed(2);

  const msg = `
📊 *Contract Info*
👤 Owner: ${createAddressLink(owner)}
💰 Fee: ${feePercent}/${denom} (${percent}%)
💳 Accumulated Fee: ${formatValue(fee, 9)} WSOL
🪙 WSOL Token: ${createAddressLink(wsol)}
📈 Bonding Curve: ${createAddressLink(bondingCurve)}
🏭 ERC20 Factory: ${createAddressLink(factory)}
💼 Payer: \`${ethers.encodeBase58(payer)}\`
`;

  bot.sendMessage(chatId, msg, { parse_mode: "Markdown", ...mainKeyboard });
}

async function showTokenInfo(chatId, tokenAddr) {
  const info = await contract.tokens(tokenAddr);
  const neonAddr = await contract.getNeonAddress(tokenAddr);
  const states = ["NOT_CREATED", "FUNDING", "TRADING"];

  const msg = `
📊 *Token Info*
📍 Address: \`${tokenAddr}\`
🎯 Funding Goal: ${formatValue(info.fundingGoal, 9)} WSOL
💰 Collateral: ${formatValue(info.collateralAmount, 9)} WSOL
📦 Initial Supply: ${formatValue(info.initialSupply, 9)} tokens
📦 Funding Supply: ${formatValue(info.fundingSupply, 9)} tokens
⚡ State: ${states[info.state]}
🔗 Neon: \`${ethers.encodeBase58(neonAddr)}\`
`;

  bot.sendMessage(chatId, msg, { parse_mode: "Markdown", ...mainKeyboard });
}

async function calculateBuy(chatId, tokenAddr, wsolAmt) {
  const amtWei = parseValue(wsolAmt, 9);
  const res = await contract.calculateBuyAmount(tokenAddr, amtWei);

  const msg = `
💰 *Buy Calculation*
🪙 WSOL: ${wsolAmt}
🎯 Receive: ${formatValue(res.receiveAmount, 9)} tokens
📦 Available: ${formatValue(res.availableSupply, 9)} tokens
📊 Total: ${formatValue(res.totalSupply, 9)} tokens
💳 After Fee: ${formatValue(res.contributionWithoutFee, 9)} WSOL
`;

  bot.sendMessage(chatId, msg, { parse_mode: "Markdown", ...mainKeyboard });
}

async function createTokenSale(chatId, data) {
  try {
    // Validate all required fields
    if (!data.name || !data.symbol || !data.goal || !data.init || !data.fund) {
      bot.sendMessage(
        chatId,
        "❌ Missing required fields. Please try again.",
        mainKeyboard
      );
      return;
    }

    // Validate numeric fields
    const decimals = parseInt(data.decimals) || 9;
    if (
      isNaN(parseFloat(data.goal)) ||
      isNaN(parseFloat(data.init)) ||
      isNaN(parseFloat(data.fund))
    ) {
      bot.sendMessage(
        chatId,
        "❌ Invalid numeric values. Please enter valid numbers.",
        mainKeyboard
      );
      return;
    }

    bot.sendMessage(
      chatId,
      `🚀 Creating sale: *${data.name} (${data.symbol})*`,
      {
        parse_mode: "Markdown",
      }
    );

    // Show the parameters being used
    const summary = `
📋 *Token Sale Parameters:*
• Name: ${data.name}
• Symbol: ${data.symbol}
• Decimals: ${decimals}
• Funding Goal: ${data.goal} WSOL
• Initial Supply: ${data.init} tokens
• Funding Supply: ${data.fund} tokens
`;
    bot.sendMessage(chatId, summary, { parse_mode: "Markdown" });

    const tx = await contractWithSigner.createTokenSale(
      data.name,
      data.symbol,
      decimals,
      parseValue(data.goal, 9),
      parseValue(data.init, 9),
      parseValue(data.fund, 9)
    );

    bot.sendMessage(
      chatId,
      `📝 Tx submitted: ${createTxLink(tx.hash)}\n⏳ Waiting...`,
      {
        parse_mode: "Markdown",
      }
    );

    const receipt = await tx.wait();

    let tokenAddr = "";
    for (let log of receipt.logs) {
      try {
        const parsed = contract.interface.parseLog(log);
        if (parsed.name === "TokenSaleCreated") {
          tokenAddr = parsed.args.token;
          break;
        }
      } catch {}
    }

    bot.sendMessage(
      chatId,
      `✅ Token sale created!\n📍 Address: ${
        tokenAddr ? createAddressLink(tokenAddr) : "N/A"
      }`,
      { parse_mode: "Markdown", ...mainKeyboard }
    );
  } catch (error) {
    console.error("Error creating token sale:", error);
    bot.sendMessage(
      chatId,
      `❌ Error creating token sale: ${error.message}`,
      mainKeyboard
    );
  }
}

async function buyTokens(chatId, tokenAddr, wsolAmt) {
  bot.sendMessage(chatId, `🛒 Buying *${wsolAmt} WSOL* from \`${tokenAddr}\``, {
    parse_mode: "Markdown",
  });

  const amtWei = parseValue(wsolAmt, 9);
  const wsolContract = new ethers.Contract(
    await contract.wsolToken(),
    [
      "function allowance(address,address) view returns(uint256)",
      "function approve(address,uint256) returns(bool)",
    ],
    wallet
  );

  const allowance = await wsolContract.allowance(
    wallet.address,
    CONTRACT_ADDRESS
  );
  if (allowance < amtWei) {
    bot.sendMessage(chatId, "⏳ Approving WSOL...");
    const approveTx = await wsolContract.approve(
      CONTRACT_ADDRESS,
      ethers.MaxUint256
    );
    await approveTx.wait();
    bot.sendMessage(chatId, "✅ WSOL approved!");
  }

  const tx = await contractWithSigner.buy(tokenAddr, amtWei);
  bot.sendMessage(chatId, `📝 Tx submitted: ${createTxLink(tx.hash)}`, {
    parse_mode: "Markdown",
  });
  const receipt = await tx.wait();

  let msg = "✅ Tokens purchased!";
  for (let log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed.name === "TokenLiqudityAdded") {
        msg += `\n🎉 Funding goal reached!\nPool: \`${ethers.encodeBase58(
          parsed.args.poolId
        )}\``;
      }
    } catch {}
  }
  bot.sendMessage(chatId, msg, { parse_mode: "Markdown", ...mainKeyboard });
}

async function claimFees(chatId) {
  const owner = await contract.owner();
  if (wallet.address.toLowerCase() !== owner.toLowerCase()) {
    bot.sendMessage(chatId, "❌ Only owner can claim fees.");
    return;
  }
  bot.sendMessage(chatId, "💰 Claiming fees...");
  const tx = await contractWithSigner.claimTokenSaleFee();
  bot.sendMessage(chatId, `📝 Tx: ${createTxLink(tx.hash)}`, {
    parse_mode: "Markdown",
  });
  await tx.wait();
  bot.sendMessage(chatId, "✅ Fees claimed!", mainKeyboard);
}

async function setFee(chatId, feePoints) {
  bot.sendMessage(chatId, `⚙️ Setting fee: ${feePoints} bp`);
  const tx = await contractWithSigner.setFeePercent(parseInt(feePoints));
  bot.sendMessage(chatId, `📝 Tx: ${createTxLink(tx.hash)}`, {
    parse_mode: "Markdown",
  });
  await tx.wait();
  bot.sendMessage(chatId, "✅ Fee updated!", mainKeyboard);
}

// === DIAGNOSTIC FUNCTIONS ===

async function checkWalletSetup(chatId) {
  try {
    bot.sendMessage(chatId, "🔍 Checking wallet setup...");

    // Check Neon EVM wallet
    const balance = await provider.getBalance(wallet.address);
    const blockNumber = await provider.getBlockNumber();

    // Check WSOL setup
    const wsolAddress = await contract.wsolToken();
    const wsolContract = new ethers.Contract(
      wsolAddress,
      [
        "function balanceOf(address) view returns (uint256)",
        "function allowance(address,address) view returns (uint256)",
        "function symbol() view returns (string)",
      ],
      provider
    );

    const wsolBalance = await wsolContract.balanceOf(wallet.address);
    const wsolAllowance = await wsolContract.allowance(
      wallet.address,
      CONTRACT_ADDRESS
    );
    const wsolSymbol = await wsolContract.symbol();

    const msg = `
🔍 *Wallet Setup Check*

✅ *Neon EVM Wallet:*
• Address: ${createAddressLink(wallet.address)}
• NEON Balance: ${formatValue(balance)} NEON
• Block: ${blockNumber}

🪙 *WSOL Setup:*
• Contract: ${createAddressLink(wsolAddress)}
• Balance: ${formatValue(wsolBalance, 9)} ${wsolSymbol}
• Allowance: ${formatValue(wsolAllowance, 9)} ${wsolSymbol}

${wsolBalance > 0 ? "✅" : "❌"} WSOL Balance: ${
      wsolBalance > 0 ? "OK" : "Need tokens from faucet"
    }
${wsolAllowance > 0 ? "✅" : "⚠️"} Allowance: ${
      wsolAllowance > 0 ? "OK" : "Will auto-approve on buy"
    }

💡 *Need WSOL?* Visit: https://neonfaucet.org/
`;

    bot.sendMessage(chatId, msg, { parse_mode: "Markdown", ...mainKeyboard });
  } catch (error) {
    console.error("Error checking wallet setup:", error);
    bot.sendMessage(
      chatId,
      `❌ Error checking wallet: ${error.message}`,
      mainKeyboard
    );
  }
}

async function debugTokenPurchase(chatId, tokenAddress, wsolAmount) {
  try {
    bot.sendMessage(
      chatId,
      `🩺 Debugging purchase of ${wsolAmount} WSOL from ${tokenAddress}...`
    );

    let debugReport = "🔍 *Debug Report*\n\n";

    // 1. Check token state
    const tokenInfo = await contract.tokens(tokenAddress);
    const tokenStates = ["NOT_CREATED", "FUNDING", "TRADING"];

    debugReport += `📊 *Token State:*\n`;
    debugReport += `• Address: ${createAddressLink(tokenAddress)}\n`;
    debugReport += `• State: ${tokenStates[tokenInfo.state]}\n`;
    debugReport += `• Funding Goal: ${formatValue(
      tokenInfo.fundingGoal,
      9
    )} WSOL\n`;
    debugReport += `• Collateral: ${formatValue(
      tokenInfo.collateralAmount,
      9
    )} WSOL\n`;
    debugReport += `• Status: ${
      tokenInfo.state === 1 ? "✅ Ready for funding" : "❌ Not accepting funds"
    }\n\n`;

    if (tokenInfo.state !== 1) {
      debugReport += `❌ *ERROR:* Token is not in FUNDING state!\n`;
      bot.sendMessage(chatId, debugReport, {
        parse_mode: "Markdown",
        ...mainKeyboard,
      });
      return;
    }

    // 2. Check amount
    const amountInWei = parseValue(wsolAmount, 9);
    debugReport += `💰 *Amount Check:*\n`;
    debugReport += `• Amount: ${wsolAmount} WSOL\n`;
    debugReport += `• Wei: ${amountInWei.toString()}\n`;
    debugReport += `• Status: ${
      amountInWei > 0 ? "✅ Valid" : "❌ Invalid"
    }\n\n`;

    // 3. Check balances
    const neonBalance = await provider.getBalance(wallet.address);
    const wsolAddress = await contract.wsolToken();
    const wsolContract = new ethers.Contract(
      wsolAddress,
      [
        "function balanceOf(address) view returns (uint256)",
        "function allowance(address,address) view returns (uint256)",
      ],
      provider
    );

    const wsolBalance = await wsolContract.balanceOf(wallet.address);
    const wsolAllowance = await wsolContract.allowance(
      wallet.address,
      CONTRACT_ADDRESS
    );

    debugReport += `💼 *Balance Check:*\n`;
    debugReport += `• NEON: ${formatValue(neonBalance)} NEON\n`;
    debugReport += `• WSOL: ${formatValue(wsolBalance, 9)} WSOL\n`;
    debugReport += `• Allowance: ${formatValue(wsolAllowance, 9)} WSOL\n`;
    debugReport += `• Sufficient WSOL: ${
      wsolBalance >= amountInWei ? "✅ Yes" : "❌ No"
    }\n\n`;

    if (wsolBalance < amountInWei) {
      debugReport += `❌ *ERROR:* Insufficient WSOL balance!\n`;
      debugReport += `• Required: ${wsolAmount} WSOL\n`;
      debugReport += `• Available: ${formatValue(wsolBalance, 9)} WSOL\n`;
      bot.sendMessage(chatId, debugReport, {
        parse_mode: "Markdown",
        ...mainKeyboard,
      });
      return;
    }

    // 4. Test calculation
    try {
      const calculation = await contract.calculateBuyAmount(
        tokenAddress,
        amountInWei
      );
      debugReport += `🧮 *Buy Calculation:*\n`;
      debugReport += `• Tokens to receive: ${formatValue(
        calculation.receiveAmount,
        9
      )}\n`;
      debugReport += `• Available supply: ${formatValue(
        calculation.availableSupply,
        9
      )}\n`;
      debugReport += `• After fee: ${formatValue(
        calculation.contributionWithoutFee,
        9
      )} WSOL\n`;
      debugReport += `• Status: ✅ Calculation successful\n\n`;
    } catch (calcError) {
      debugReport += `❌ *ERROR:* Calculation failed!\n`;
      debugReport += `• Error: ${calcError.message}\n\n`;
      bot.sendMessage(chatId, debugReport, {
        parse_mode: "Markdown",
        ...mainKeyboard,
      });
      return;
    }

    // 5. Test gas estimation
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
      debugReport += `⛽ *Gas Estimation:*\n`;
      debugReport += `• Estimated gas: ${gasEstimate.toString()}\n`;
      debugReport += `• Status: ✅ Transaction should succeed\n\n`;

      debugReport += `✅ *All checks passed!* Transaction should work.`;
    } catch (gasError) {
      debugReport += `❌ *ERROR:* Gas estimation failed!\n`;
      debugReport += `• Error: ${gasError.message}\n`;

      // Try to decode common errors
      if (gasError.data) {
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
          debugReport += `• Decoded error: ${errorName}\n`;
        }
      }
    }

    bot.sendMessage(chatId, debugReport, {
      parse_mode: "Markdown",
      ...mainKeyboard,
    });
  } catch (error) {
    console.error("Error debugging token purchase:", error);
    bot.sendMessage(chatId, `❌ Debug error: ${error.message}`, mainKeyboard);
  }
}

// === START BOT ===
console.log("🚀 Meme Launchpad Telegram Bot running...");
