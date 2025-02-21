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
  MIN_DELAY_BETWEEN_WALLETS: 5 * 1000,
  MAX_DELAY_BETWEEN_WALLETS: 10 * 1000,
  RESTART_DELAY: 5 * 60 * 60 * 1000,
  MAX_RETRIES: 3,
  API_ENDPOINTS: {
    CLAIMR: "https://prod.claimr.io",
    NOMISMA: "https://nomisma-api-production.up.railway.app",
  }
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
    this.sessionIds = new Map();
    this.tokens = new Map();
  }

  async generateSignature(wallet, message) {
    const signature = await wallet.signMessage(message);
    return signature;
  }

  async initializeSession(wallet) {
    try {
      const sessionResponse = await axios.get(`${CONFIG.API_ENDPOINTS.CLAIMR}/sessions?id=${this.generateSessionId()}`, {
        headers: {
          'content-type': 'application/json',
          'accept': '*/*',
          'origin': 'https://widgets.claimr.io',
          'referer': 'https://widgets.claimr.io/',
        }
      });

      if (sessionResponse.data.success) {
        const sessionId = sessionResponse.data.session_id;
        this.sessionIds.set(wallet, sessionId);
        return sessionId;
      }
      throw new Error("Failed to initialize session");
    } catch (error) {
      throw new Error(`Session initialization failed: ${error.message}`);
    }
  }

  generateSessionId() {
    return Math.random().toString(36).substring(2, 15);
  }

  async authenticateWallet(wallet, privateKey) {
    try {
      const ethWallet = new Wallet(privateKey);
      const message = `Please sign your public key '${ethWallet.publicKey}' in order to login into quest campaign`;
      const signature = await this.generateSignature(ethWallet, message);

      const authResponse = await axios.post(`${CONFIG.API_ENDPOINTS.CLAIMR}/auth/wallet`, {
        chain_id: "eip155",
        network: "eth_mainnet",
        address: wallet,
        signature: signature,
        message: message,
        state: this.generateState()
      }, {
        headers: {
          'content-type': 'application/json',
          'accept': '*/*',
          'origin': 'https://widgets.claimr.io',
          'referer': 'https://widgets.claimr.io/',
        }
      });

      if (authResponse.data.success) {
        const token = authResponse.data.data.access_token;
        this.tokens.set(wallet, token);
        return token;
      }
      throw new Error("Authentication failed");
    } catch (error) {
      throw new Error(`Authentication failed: ${error.message}`);
    }
  }

  generateState() {
    // Generate a random state string similar to the one in the example
    return Buffer.from(Math.random().toString(36).substring(2)).toString('base64');
  }

  async performDailyCheckin(wallet) {
    try {
      const token = this.tokens.get(wallet);
      const sessionId = this.sessionIds.get(wallet);
      
      if (!token || !sessionId) {
        throw new Error("Missing authentication tokens");
      }

      const checkinResponse = await axios.post(`${CONFIG.API_ENDPOINTS.CLAIMR}/v2/widget/campaign`, {
        account: "",
        platform: "common",
        otag: "launchjoy",
        ptag: "nomisma",
        gid: "14jN_FHp",
        cid: "a19QpMuo",
        aid: "dmqpPJY3",
        ref_id: this.generateRefId(),
        data: {},
        source: {},
        env: "",
        location: "Indonesia",
        session_id: sessionId,
        fid: this.generateFid(),
        rate: 0
      }, {
        headers: {
          'authorization': `Bearer ${token}`,
          'content-type': 'application/json',
          'accept': '*/*',
          'origin': 'https://widgets.claimr.io',
          'referer': 'https://widgets.claimr.io/',
        }
      });

      if (checkinResponse.data.success) {
        return checkinResponse.data.data;
      }
      throw new Error("Daily check-in failed");
    } catch (error) {
      throw new Error(`Daily check-in failed: ${error.message}`);
    }
  }

  generateRefId() {
    return Math.random().toString(36).substring(2, 10);
  }

  generateFid() {
    return Math.random().toString(36).substring(2, 15);
  }

  async getProgress(wallet) {
    try {
      const token = this.tokens.get(wallet);
      const sessionId = this.sessionIds.get(wallet);

      if (!token || !sessionId) {
        throw new Error("Missing authentication tokens");
      }

      const progressResponse = await axios.get(
        `${CONFIG.API_ENDPOINTS.CLAIMR}/v2/widget/campaign/progress?otag=launchjoy&ptag=nomisma&session_id=${sessionId}`,
        {
          headers: {
            'authorization': `Bearer ${token}`,
            'content-type': 'application/json',
            'accept': '*/*',
            'origin': 'https://widgets.claimr.io',
            'referer': 'https://widgets.claimr.io/',
          }
        }
      );

      if (progressResponse.data.success) {
        return progressResponse.data.data.progress;
      }
      throw new Error("Failed to get progress");
    } catch (error) {
      throw new Error(`Progress check failed: ${error.message}`);
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

      // Initialize session
      console.log(`${colors.cyan}Initializing session for wallet ${colors.yellow}${walletNum}/${totalWallets}${colors.reset}`);
      await this.initializeSession(wallet);

      // Authenticate wallet
      console.log(`${colors.cyan}Authenticating wallet ${colors.yellow}${walletNum}/${totalWallets}${colors.reset}`);
      await this.authenticateWallet(wallet, privateKey);

      // Perform daily check-in
      console.log(`${colors.cyan}Performing daily check-in for wallet ${colors.yellow}${walletNum}/${totalWallets}${colors.reset}`);
      await this.performDailyCheckin(wallet);

      // Get progress
      const progress = await this.getProgress(wallet);
      stats.lastPing = new Date().toLocaleTimeString();
      stats.points = progress.xp || 0;
      stats.status = "Active";
      stats.error = null;
      this.errorCounts.set(wallet, 0);

      console.log(`${colors.green}Successfully processed wallet ${walletNum}/${totalWallets}. Points: ${colors.yellow}${stats.points}${colors.reset}`);
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

  // [Previous helper methods remain unchanged]
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
    this.sessionIds.delete(wallet);
    this.tokens.delete(wallet);
    
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

      this.wallets = [];
      this.privateKeys = new Map();
      this.errorCounts = new Map();
      this.sessionIds = new Map();
      this.tokens = new Map();

      for (let privateKey of privateKeys) {
        try {
          const wallet = new Wallet(privateKey);
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
