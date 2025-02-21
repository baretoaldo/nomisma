import fs from "fs/promises";
import axios from "axios";
import { Wallet } from "ethers";

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
};

const CONFIG = {
  BASE_URL: "https://prod.claimr.io",
  CIVIC_URL: "https://apikeys.civiccomputing.com",
  NOMISMA_URL: "https://nomisma-api-production.up.railway.app",
  MIN_DELAY: 5 * 1000,
  MAX_DELAY: 10 * 1000,
  RESTART_DELAY: 5 * 60 * 60 * 1000,
  MAX_RETRIES: 3,
  CAMPAIGN_PARAMS: {
    otag: "launchjoy",
    ptag: "nomisma",
    ref_id: "FjMCVEzG"
  }
};

class ClaimrClient {
  constructor(privateKey) {
    this.wallet = new Wallet(privateKey);
    this.sessionId = null;
    this.accessToken = null;
    this.civicKey = "74872c15308a8d1016ce517d69abf4005aba4d4d";
  }

  async getCommonHeaders() {
    return {
      "sec-ch-ua": '"Not A(Brand";v="8", "Chromium";v="132"',
      "user-agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36",
      "sec-ch-ua-platform": '"Android"',
      "origin": "https://widgets.claimr.io",
      "referer": "https://widgets.claimr.io/",
      "accept-encoding": "gzip, deflate, br"
    };
  }

  async getAuthHeaders() {
    return {
      ...(await this.getCommonHeaders()),
      "content-type": "application/json",
      "authorization": this.accessToken ? `Bearer ${this.accessToken}` : "",
      "session-id": this.sessionId
    };
  }

  async getCookieConsent() {
    const response = await axios.get(`${CONFIG.CIVIC_URL}/c/v`, {
      params: {
        d: "widgets.claimr.io",
        p: "CookieControl Single-Site",
        v: "9",
        k: this.civicKey,
        format: "json"
      },
      headers: await this.getCommonHeaders()
    });
    return response.data;
  }

  async createSession() {
    const sessionId = `session_${Math.random().toString(36).substr(2, 9)}`;
    const response = await axios.get(`${CONFIG.BASE_URL}/sessions`, {
      params: { id: sessionId },
      headers: await this.getCommonHeaders()
    });
    this.sessionId = sessionId;
    return response.data;
  }

  async walletLogin() {
    const message = `Please sign your public key in order to login into quest campaign`;
    const signature = await this.wallet.signMessage(message);
    
    const payload = {
      chain_id: "eip155",
      network: "arbitrum",
      address: this.wallet.address,
      signature: signature,
      message: message,
      state: "MDo6cGJNb0YyNDFSYkNrc0VhZTo6b1VKXzhzZUI6OmZMRUZ6dzkwOjpjSXVFTGE1S2ZVam9jWEptOjpJbmRvbmVzaWE%3D"
    };

    const response = await axios.post(`${CONFIG.BASE_URL}/auth/wallet`, payload, {
      headers: await this.getAuthHeaders()
    });
    
    this.accessToken = response.data.data.access_token;
    return response.data;
  }

  async getCampaignProgress() {
    const response = await axios.get(`${CONFIG.BASE_URL}/v2/widget/campaign/progress`, {
      params: {
        ...CONFIG.CAMPAIGN_PARAMS,
        session_id: this.sessionId
      },
      headers: await this.getAuthHeaders()
    });
    return response.data.data;
  }

  async dailyCheckin() {
    const message = "Please sign to confirm daily check-in";
    const signature = await this.wallet.signMessage(message);
    
    const payload = {
      ...CONFIG.CAMPAIGN_PARAMS,
      session_id: this.sessionId,
      platform: "common",
      signature: signature,
      location: "Indonesia",
      fid: "_Q]X=@9GbKh2L?Ji",
      rate: 0
    };

    const response = await axios.post(`${CONFIG.BASE_URL}/v2/widget/campaign`, payload, {
      headers: await this.getAuthHeaders()
    });
    
    return response.data.data;
  }

  async executeFlow() {
    try {
      await this.getCookieConsent();
      await this.createSession();
      await this.walletLogin();
      const progress = await this.getCampaignProgress();
      await this.dailyCheckin();
      return progress;
    } catch (error) {
      throw new Error(`API Error: ${error.response?.data?.message || error.message}`);
    }
  }
}

class WalletDashboard {
  constructor() {
    this.wallets = [];
    this.privateKeys = new Map();
    this.errorCounts = new Map();
    this.removedWallets = [];
  }

  async initialize() {
    const data = await fs.readFile("data.txt", "utf8");
    const privateKeys = data.split("\n").filter(line => line.trim());
    
    this.wallets = privateKeys.map(pk => {
      const wallet = new Wallet(pk);
      this.privateKeys.set(wallet.address, pk);
      return wallet.address;
    });

    console.log(`${colors.cyan}Loaded ${this.wallets.length} wallets${colors.reset}`);
  }

  async processWallet(walletAddress) {
    const privateKey = this.privateKeys.get(walletAddress);
    const client = new ClaimrClient(privateKey);
    
    try {
      const result = await client.executeFlow();
      const points = result.progress.pcn;
      console.log(`${colors.green}Success for ${walletAddress} | Points: ${points}${colors.reset}`);
      return true;
    } catch (error) {
      console.error(`${colors.red}Error for ${walletAddress}: ${error.message}${colors.reset}`);
      return false;
    }
  }

  async processAllWallets() {
    while (this.wallets.length > 0) {
      for (const [index, wallet] of this.wallets.entries()) {
        const success = await this.processWallet(wallet);
        
        if (!success) {
          const errorCount = this.errorCounts.get(wallet) || 0;
          if (errorCount >= CONFIG.MAX_RETRIES) {
            await this.removeWallet(wallet);
          } else {
            this.errorCounts.set(wallet, errorCount + 1);
          }
        }
        
        if (index < this.wallets.length - 1) {
          const delay = Math.floor(Math.random() * 
            (CONFIG.MAX_DELAY - CONFIG.MIN_DELAY)) + CONFIG.MIN_DELAY;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      
      console.log(`${colors.cyan}Cycle completed. Restarting in ${CONFIG.RESTART_DELAY/3600000} hours...${colors.reset}`);
      await new Promise(resolve => setTimeout(resolve, CONFIG.RESTART_DELAY));
    }
  }

  async removeWallet(wallet) {
    this.wallets = this.wallets.filter(w => w !== wallet);
    this.privateKeys.delete(wallet);
    this.errorCounts.delete(wallet);
    this.removedWallets.push(wallet);
    await this.saveRemovedWallets();
  }

  async saveRemovedWallets() {
    const content = this.removedWallets.join('\n');
    await fs.appendFile('removed_wallets.txt', content + '\n');
  }
}

(async () => {
  try {
    const dashboard = new WalletDashboard();
    await dashboard.initialize();
    await dashboard.processAllWallets();
  } catch (error) {
    console.error(`${colors.red}Fatal error: ${error}${colors.reset}`);
    process.exit(1);
  }
})();
