#!/usr/bin/env node

/**
 * Reddit MCP Buddy CLI
 * Handle authentication setup and server startup
 */

import { AuthManager } from './core/auth.js';
import { SERVER_VERSION } from './mcp-server.js';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import readline from 'node:readline/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function setupAuth() {
  console.log('\n🚀 Leelo (Reddit Installed App) Authentication Setup\n');
  console.log('This will help you set up authentication with your Client ID.\n');

  console.log('Step 1: Create a Reddit App');
  console.log('  1. Open: https://www.reddit.com/prefs/apps');
  console.log('  2. Click "Create App" or "Create Another App"');
  console.log('  3. Fill in:');
  console.log('     • Name: Leelo (or anything)');
  console.log('     • Type: Select "installed app" (IMPORTANT!)');
  console.log('     • Description: Personal use');
  console.log('     • Redirect URI: http://localhost:8080');
  console.log('  4. Click "Create app"\n');

  console.log('Step 2: Find your Client ID');
  console.log('  • It is under the "installed app" name (e.g., bi6zE-l1dcK5eiKH_VqrvA)');
  console.log('  • It is NOT the secret (Installed Apps do not have secrets)\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const clientId = await rl.question('Enter your Client ID: ');

    if (!/^[A-Za-z0-9_-]{10,30}$/.test(clientId)) {
      console.error('\n❌ Invalid Client ID format.');
      process.exit(1);
    }

    console.log('\n🔄 Testing authentication...');

    const authManager = new AuthManager();
    // Use manual set for testing
    (authManager as any).config = {
      clientId,
      userAgent: 'RedditInstalledApp/1.0'
    };

    try {
      await authManager.refreshAccessToken();
      console.log('✅ Success! Authentication configured.');
      console.log('📊 Mode: Installed-App (60 requests per minute)');
      console.log('\nTo start using Leelo, run:');
      console.log('  leelo\n');
    } catch (error: any) {
      console.error('\n❌ Failed to authenticate. Please check your Client ID.');
      console.error('Error:', error.message);
      process.exit(1);
    }
  } finally {
    rl.close();
  }
}

async function startServer() {
  // Check if running in development
  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    // Development mode - run TypeScript directly
    const serverPath = join(__dirname, 'index.ts');

    // Improved child process error handling
    let child: any;
    try {
      child = spawn('tsx', [serverPath], {
        stdio: 'inherit',
        env: { ...process.env },
      });

      // Verify child process was created successfully
      if (!child || !child.pid) {
        throw new Error('Failed to create child process');
      }
    } catch (error: any) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('❌ Failed to spawn development server:', errorMsg);

      // Check if tsx is not installed
      if (errorMsg.includes('ENOENT') || errorMsg.includes('not found')) {
        console.error('\nNote: Development mode requires tsx to be installed.');
        console.error('Run: npm install');
      }
      process.exit(1);
    }

    // Handle errors after spawn
    child.on('error', (error: any) => {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('❌ Child process error:', errorMsg);
      process.exit(1);
    });

    // Handle unexpected exit
    child.on('exit', (code: number | null, signal: string | null) => {
      if (code && code !== 0) {
        console.error(`❌ Server exited with code ${code}`);
      } else if (signal) {
        console.error(`❌ Server terminated by signal ${signal}`);
      }
      process.exit(code || 0);
    });
  } else {
    // Production mode - run compiled JavaScript with improved error handling
    const serverPath = join(__dirname, 'index.js');
    const serverUrl = pathToFileURL(serverPath).href;

    // Improved dynamic import error handling
    try {
      // Check if the file exists first
      const { promises: fs } = await import('node:fs');
      try {
        await fs.access(serverPath);
      } catch {
        throw new Error(`Server file not found: ${serverPath}. Run: npm run build`);
      }

      // Attempt dynamic import
      await import(serverUrl);
    } catch (error: any) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      if (errorMsg.includes('not found') || errorMsg.includes('ENOENT')) {
        console.error('❌ Server file not found. Run: npm run build');
      } else if (errorMsg.includes('Cannot find module')) {
        console.error('❌ Module import error:', errorMsg);
        console.error('Try running: npm install');
      } else if (errorMsg.includes('Unexpected token')) {
        console.error('❌ Syntax error in server code:', errorMsg);
        console.error('Try running: npm run typecheck');
      } else {
        console.error('❌ Failed to start server:', errorMsg);
      }

      process.exit(1);
    }
  }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.includes('--auth') || args.includes('-a')) {
  // Run authentication setup
  setupAuth().catch((error) => {
    console.error('Setup failed:', error);
    process.exit(1);
  });
} else if (args.includes('--help') || args.includes('-h')) {
  console.log('Leelo - A Spanish literary way to read Reddit via MCP\n');
  console.log('Usage:');
  console.log('  leelo           Start the MCP server');
  console.log('  leelo --auth    Set up Reddit authentication (optional)');
  console.log('  leelo --help    Show this help message\n');
  console.log('Features:');
  console.log('  • Browse subreddits with smart summaries');
  console.log('  • Search Reddit with advanced filters');
  console.log('  • Analyze trends and sentiment');
  console.log('  • Compare opinions across subreddits');
  console.log('  • And much more!\n');
  console.log('Learn more: https://github.com/karanb192/reddit-mcp-buddy');
} else if (args.includes('--version') || args.includes('-v')) {
  console.log(`Leelo v${SERVER_VERSION}`);
} else {
  // Start the server
  startServer().catch((error) => {
    console.error('Failed to start:', error);
    process.exit(1);
  });
}
