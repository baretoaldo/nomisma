import fs from "fs/promises";
import axios from "axios";
import { Wallet } from "ethers";

const API_BASE_URL = "https://prod.claimr.io";
const NOMISMA_API_URL = "https://nomisma-api-production.up.railway.app";
const CONFIG = {
  MIN_DELAY_BETWEEN_WALLETS: 5000,
  MAX_DELAY_BETWEEN_WALLETS: 10000,
  RESTART_DELAY: 18000000,
  MAX_RETRIES: 3,
};

const getRandomDelay = () => Math.floor(Math.random() * (CONFIG.MAX_DELAY_BETWEEN_WALLETS - CONFIG.MIN_DELAY_BETWEEN_WALLETS + 1) + CONFIG.MIN_DELAY_BETWEEN_WALLETS);

class WalletDashboard {
  constructor() {
    this.wallets = [];
    this.walletStats = new Map();
    this.privateKeys = new Map();
    this.currentWalletIndex = 0;
    this.isRunning = true;
    this.errorCounts = new Map();
  }

  async initialize() {
    try {
      const data = await fs.readFile("data.txt", "utf8");
      const privateKeys = data.split("\n").filter((line) => line.trim() !== "");

      for (let privateKey of privateKeys) {
        try {
          const wallet = new Wallet(privateKey);
          this.wallets.push(wallet.address);
          this.privateKeys.set(wallet.address, privateKey);
        } catch (error) {
          console.error(`Invalid private key: ${error.message}`);
        }
      }
    } catch (error) {
      console.error(`Error reading data.txt: ${error}`);
      process.exit(1);
    }
  }

  async request(endpoint, method = "GET", data = {}, headers = {}) {
    try {
      const response = await axios({
        method,
        url: endpoint.includes("nomisma") ? `${NOMISMA_API_URL}${endpoint}` : `${API_BASE_URL}${endpoint}`,
        data,
        headers: { "Content-Type": "application/json", ...headers },
      });
      return response.data;
    } catch (error) {
      console.error(`Request failed: ${endpoint} - ${error.message}`);
      return null;
    }
  }

  async authenticate(wallet) {
    const privateKey = this.privateKeys.get(wallet);
    if (!privateKey) return null;

    const walletInstance = new Wallet(privateKey);
    const message = "Sign in to Claimr";
    const signature = await walletInstance.signMessage(message);

    const response = await this.request("/auth/wallet", "POST", {
      address: walletInstance.address,
      signature,
      message,
    });

    return response?.data?.access_token || null;
  }

  async processWallet(wallet) {
    const token = await this.authenticate(wallet);
    if (!token) return;

    const headers = { Authorization: `Bearer ${token}` };
    await this.request("/v2/widget/campaign/progress?session_id=randomSessionID", "GET", {}, headers);
    await this.request("/v2/widget/hiscores?session_id=randomSessionID", "GET", {}, headers);
    await this.request("/logins", "GET", {}, headers);
    await this.request("/api/games/wheel/prizes", "GET", {}, headers);
    await this.request("/sessions?id=randomSessionID", "GET", {}, headers);
  }

  async processAllWallets() {
    while (this.isRunning) {
      for (this.currentWalletIndex = 0; this.currentWalletIndex < this.wallets.length; this.currentWalletIndex++) {
        await this.processWallet(this.wallets[this.currentWalletIndex]);
        await new Promise((resolve) => setTimeout(resolve, getRandomDelay()));
      }
      await new Promise((resolve) => setTimeout(resolve, CONFIG.RESTART_DELAY));
    }
  }
}

const dashboard = new WalletDashboard();
dashboard.initialize().then(() => dashboard.processAllWallets());
