import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config();
// Throwaway testnet wallets made by scripts/new-test-wallet.mjs live in ../.env.arc (gitignored)
dotenv.config({ path: path.join(__dirname, "../.env.arc") });
// Arc MAINNET keys live only in ../.env.mainnet (gitignored), filled in by the owner. Never in .env.arc.
const mainnet = dotenv.config({ path: path.join(__dirname, "../.env.mainnet"), processEnv: {} }).parsed ?? {};

// Testnet only. DEPLOYER_KEY lives in .env, which is never committed.
const deployerKey = process.env.DEPLOYER_KEY;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url: "http://127.0.0.1:8555",
      chainId: 31337,
    },
    arcTestnet: {
      url: process.env.ARC_RPC_URL || "https://rpc.testnet.arc.io",
      chainId: 5042002,
      accounts: deployerKey ? [deployerKey] : [],
      // Arc's minimum base fee is 20 gwei, so never go below it
      gasPrice: 40_000_000_000,
    },
    arcMainnet: {
      url: mainnet.ARC_MAINNET_RPC_URL || "https://rpc.mainnet.arc.io",
      chainId: 5042,
      accounts: mainnet.MAINNET_DEPLOYER_KEY ? [mainnet.MAINNET_DEPLOYER_KEY] : [],
      gasPrice: 40_000_000_000,
    },
  },
  mocha: { timeout: 60_000 },
};

export default config;
