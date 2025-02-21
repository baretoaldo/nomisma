import fs from "fs/promises";
import axios from "axios";
import { Wallet } from "ethers";

// Colors for console output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  blue: "\x1b[34m", // Ditambahkan untuk respons server
};

const CONFIG = {
  MIN_DELAY_BETWEEN_WALLETS: 5 * 1000,
  MAX_DELAY_BETWEEN_WALLETS: 10 * 1000,
  RESTART_DELAY: 5 * 60 * 60 * 1000,
  MAX_RETRIES: 3,
};

const BASE_HEADERS = {
  "accept": "application/json",
  "content-type": "application/json",
  "sec-ch-ua": '"Not A(Brand";v="8", "Chromium";v="132"',
  "sec-ch-ua-mobile": "?1",
  "sec-ch-ua-platform": '"Android"',
  "user-agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36",
  "accept-encoding": "gzip, deflate, br",
  "accept-language": "en-US,en;q=0.9,id-ID;q=0.8,id;q=0.7"
};

const getRandomDelay = () => {
  return Math.floor(
    Math.random() * 
    (CONFIG.MAX_DELAY_BETWEEN_WALLETS - CONFIG.MIN_DELAY_BETWEEN_WALLETS + 1) +
    CONFIG.MIN_DELAY_BETWEEN_WALLETS
  );
};

class WalletDashboard {
  constructor() {
    this.wallets = [];
    this.walletStats = new Map();
    this.privateKeys = new Map();
    this.currentWalletIndex = 0;
    this.isRunning = true;
    this.errorCounts = new Map();
    this.removedWallets = [];
    this.accessTokens = new Map();
  }

  async saveRemovedWallets() {
    try {
      const timestamp = new Date().toISOString().replace(/:/g, '-');
      const content = this.removedWallets.map(wallet => 
        `${wallet.address},${wallet.privateKey},${wallet.reason},${wallet.timestamp}`
      ).join('\n');
      
      await fs.appendFile('removed_wallets.csv', content + '\n');
      console.log(`${colors.yellow}Removed wallets saved to removed_wallets.csv${colors.reset}`);
    } catch (error) {
      console.error(`${colors.red}Error saving removed wallets: ${error.message}${colors.reset}`);
    }
  }

  async removeWallet(wallet, reason) {
    const privateKey = this.privateKeys.get(wallet);
    this.wallets = this.wallets.filter(w => w !== wallet);
    this.privateKeys.delete(wallet);
    this.walletStats.delete(wallet);
    this.errorCounts.delete(wallet);
    this.accessTokens.delete(wallet);
    
    this.removedWallets.push({
      address: wallet,
      privateKey: privateKey,
      reason: reason,
      timestamp: new Date().toISOString()
    });
    
    await this.saveRemovedWallets();
    console.log(`${colors.red}Removed wallet ${wallet.substr(0, 6)}...${wallet.substr(-4)} due to: ${reason}${colors.reset}`);
  }

  increaseErrorCount(wallet) {
    const currentCount = this.errorCounts.get(wallet) || 0;
    this.errorCounts.set(wallet, currentCount + 1);
    return currentCount + 1;
  }

  async initialize() {
    try {
      const data = await fs.readFile("data.txt", "utf8");
      const privateKeys = data.split("\n").filter((line) => line.trim() !== "");

      for (let privateKey of privateKeys) {
        try {
          let formattedKey = privateKey;
          if (!privateKey.startsWith("0x")) {
            formattedKey = "0x" + privateKey;
          }

          if (!/^(0x)?[0-9a-fA-F]{64}$/.test(formattedKey)) {
            throw new Error("Invalid private key format or length");
          }

          const wallet = new Wallet(formattedKey);
          const address = wallet.address;
          this.wallets.push(address);
          this.privateKeys.set(address, privateKey);
          this.walletStats.set(address, {
            status: "Pending",
            lastPing: "-",
            points: 0,
            error: null,
          });
        } catch (error) {
          console.error(`${colors.red}Invalid private key: ${privateKey} - ${error.message}${colors.reset}`);
        }
      }

      if (this.wallets.length === 0) {
        throw new Error("No valid private keys found in data.txt");
      }
      
      console.log(`${colors.cyan}Successfully loaded ${colors.yellow}${this.wallets.length}${colors.cyan} wallets${colors.reset}`);
    } catch (error) {
      console.error(`${colors.red}Error reading data.txt: ${error}${colors.reset}`);
      process.exit(1);
    }
  }

  async authenticateWallet(wallet, privateKey) {
    try {
      const originalKey = this.privateKeys.get(wallet);
      const walletInstance = new Wallet(originalKey);
      const message = `Please sign your public key '${walletInstance.publicKey}' in order to login into quest campaign`;
      const signature = await walletInstance.signMessage(message);

      const authPayload = {
        chain_id: "eip155",
        network: "eth_mainnet",
        address: wallet,
        signature: signature,
        message: message,
        state: "MDo6cGJNb0YyNDFSYkNrc0VhZTo6b1VKXzhzZUI6OmZMRUZ6dzkwOjpjSXVFTGE1S2ZVam9jWEptOjpJbmRvbmVzaWE%3D"
      };

      const response = await axios.post(
        "https://prod.claimr.io/auth/wallet",
        authPayload,
        {
          headers: {
            ...BASE_HEADERS,
            "origin": "https://widgets.claimr.io",
            "referer": "https://widgets.claimr.io/"
          }
        }
      );

      console.log(`${colors.blue}Authentication Response:${colors.reset}`);
      console.log(`${colors.blue}${JSON.stringify(response.data, null, 2)}${colors.reset}`);

      if (response.data.success) {
        this.accessTokens.set(wallet, response.data.data.access_token);
        return true;
      }
      return false;
    } catch (error) {
      throw new Error(`Authentication failed: ${error.message}`);
    }
  }

  async checkNodeStatus(wallet) {
    try {
      const sessionId = "cIuELa5KfUjocXJm";
      const response = await axios.get(
        `https://prod.claimr.io/sessions?id=${sessionId}`,
        {
          headers: {
            ...BASE_HEADERS,
            "origin": "https://widgets.claimr.io",
            "referer": "https://widgets.claimr.io/"
          }
        }
      );

      console.log(`${colors.blue}Session Status Response:${colors.reset}`);
      console.log(`${colors.blue}${JSON.stringify(response.data, null, 2)}${colors.reset}`);

      return response.data.success;
    } catch (error) {
      console.error(`${colors.red}Error checking session status: ${error.message}${colors.reset}`);
      return false;
    }
  }

  async updatePoints(wallet) {
    try {
      const token = this.accessTokens.get(wallet);
      if (!token) {
        throw new Error("No access token found");
      }

      const response = await axios.get(
        "https://prod.claimr.io/v2/widget/campaign/progress?otag=launchjoy&ptag=nomisma&session_id=cIuELa5KfUjocXJm&ref_id=FjMCVEzG&",
        {
          headers: {
            ...BASE_HEADERS,
            "Authorization": `Bearer ${token}`,
            "origin": "https://widgets.claimr.io",
            "referer": "https://widgets.claimr.io/"
          }
        }
      );

      console.log(`${colors.blue}Progress Update Response:${colors.reset}`);
      console.log(`${colors.blue}${JSON.stringify(response.data, null, 2)}${colors.reset}`);

      if (response.data.success) {
        return {
          nodePoints: response.data.data.progress.pcn,
          xp: response.data.data.progress.xp
        };
      }
      return { nodePoints: 0 };
    } catch (error) {
      throw new Error(`Failed to update points: ${error.message}`);
    }
  }

  async signAndStart(wallet, privateKey) {
    try {
      const authSuccess = await this.authenticateWallet(wallet, privateKey);
      return authSuccess;
    } catch (error) {
      throw new Error(`Sign and start failed: ${error.message}`);
    }
  }

  async processWallet(wallet) {
    const stats = this.walletStats.get(wallet);
    const walletNum = this.currentWalletIndex + 1;
    const totalWallets = this.wallets.length;
    
    console.log(`\n${colors.cyan}--- Processing wallet ${colors.yellow}${walletNum}/${totalWallets}${colors.cyan}: ${wallet.substr(0, 6)}...${wallet.substr(-4)} ---${colors.reset}`);
    stats.status = "Processing";

    try {
      const privateKey = this.privateKeys.get(wallet);
      if (!privateKey) {
        throw new Error("Private key not found for wallet");
      }

      console.log(`${colors.cyan}Checking status for wallet ${colors.yellow}${walletNum}/${totalWallets}${colors.reset}`);
      stats.status = "Checking Status";
      
      const isRunning = await this.checkNodeStatus(wallet);
      
      if (!isRunning || !this.accessTokens.get(wallet)) {
        console.log(`${colors.yellow}Activating wallet ${walletNum}/${totalWallets}${colors.reset}`);
        stats.status = "Activating";
        
        const activated = await this.signAndStart(wallet, privateKey);
        if (!activated) {
          throw new Error("Node activation unsuccessful");
        }
        
        console.log(`${colors.green}Successfully activated wallet ${walletNum}/${totalWallets}${colors.reset}`);
        stats.status = "Activated";
        
        await new Promise((resolve) => setTimeout(resolve, 5000));
      } else {
        console.log(`${colors.green}Wallet ${walletNum}/${totalWallets} is already active${colors.reset}`);
      }

      console.log(`${colors.cyan}Pinging wallet ${colors.yellow}${walletNum}/${totalWallets}${colors.reset}`);
      const result = await this.updatePoints(wallet);
      stats.lastPing = new Date().toLocaleTimeString();
      stats.points = result.nodePoints || stats.points;
      stats.status = "Active";
      stats.error = null;
      this.errorCounts.set(wallet, 0);
      
      console.log(`${colors.green}Ping successful for wallet ${walletNum}/${totalWallets}. Current points: ${colors.green}${stats.points}${colors.reset}`);
      
      return true;
    } catch (error) {
      stats.status = "Error";
      stats.error = error.message;
      console.error(`${colors.red}Error processing wallet ${walletNum}/${totalWallets}: ${error.message}${colors.reset}`);
      
      const errorCount = this.increaseErrorCount(wallet);
      if (errorCount >= CONFIG.MAX_RETRIES) {
        await this.removeWallet(wallet, error.message);
        return false;
      }
      
      return false;
    }
  }

  async processAllWallets() {
    while (this.isRunning) {
      for (this.currentWalletIndex = 0; this.currentWalletIndex < this.wallets.length; this.currentWalletIndex++) {
        const wallet = this.wallets[this.currentWalletIndex];
        await this.processWallet(wallet);
        
        if (this.currentWalletIndex < this.wallets.length - 1) {
          const delay = getRandomDelay();
          const delaySeconds = (delay / 1000).toFixed(1);
          console.log(`${colors.cyan}Waiting ${colors.yellow}${delaySeconds}${colors.cyan} seconds before processing next wallet...${colors.reset}`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      
      if (this.wallets.length === 0) {
        console.log(`${colors.red}No wallets remaining. Stopping process.${colors.reset}`);
        this.isRunning = false;
        break;
      }
      
      console.log(`\n${colors.green}Completed processing all ${colors.yellow}${this.wallets.length}${colors.green} wallets.${colors.reset}`);
      console.log(`${colors.cyan}Waiting ${colors.yellow}${CONFIG.RESTART_DELAY / 3600000}${colors.cyan} hours before restarting the process...${colors.reset}`);
      await new Promise(resolve => setTimeout(resolve, CONFIG.RESTART_DELAY));
      console.log(`${colors.green}Restarting wallet processing cycle...${colors.reset}`);
    }
  }

  async start() {
    await this.initialize();
    await this.processAllWallets();
  }
}

const dashboard = new WalletDashboard();
dashboard.start().catch((error) => {
  console.error(`${colors.red}Fatal error: ${error}${colors.reset}`);
  process.exit(1);
});
