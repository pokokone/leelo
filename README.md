# Leelo (Léelo)

**Leelo** is a Model Context Protocol (MCP) server that enables AI assistants to browse Reddit using the official "Installed App" authentication flow.

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by Reddit.
"Reddit" is a trademark of Reddit Inc.

Leelo interacts with Reddit using the official OAuth2 API for personal use tools.

## Upstream Attribution

This project is based on:
- https://github.com/karanb192/reddit-mcp-buddy

## Features

- Performance: Achieve up to 60 requests per minute (RPM).
- Secure: Only requires a Reddit Client ID. No secrets or passwords needed.
- Focused: Optimized for "Installed App" type authorization on Reddit.
- LLM-Ready: Cleaned data and clear tool parameters for AI usage.

## Installation

1. Download the latest `leelo-release.zip` from the [Releases](https://github.com/YOUR_USERNAME/Leelo/releases) page.
2. Extract the zip file to a permanent location.
3. Configure Claude Desktop as shown below.

*Requires Node.js installed on your system.*

## Configuration

### 1. Create a Reddit App
1. Go to Reddit App Preferences at https://www.reddit.com/prefs/apps.
2. Click "Create App".
3. Fill in:
   - Name: leelo (or anything).
   - App Type: Select "installed app" (Crucial).
   - Redirect URI: http://localhost:8080.
4. Copy the Client ID (the string under the app name).

### 2. Configure Claude Desktop

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "leelo": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/Leelo/leelo.js"],
      "env": {
        "REDDIT_CLIENT_ID": "YOUR_CLIENT_ID"
      }
    }
  }
}
```

## Available Tools

- browse_subreddit: Get posts from subreddits.
- search_reddit: Search across Reddit with filters.
- get_post_details: Fetch full thread and comments.
- user_analysis: Analyze user history and activity.
- reddit_explain: Look up Reddit terminology.

## Development

To build from source:
```bash
git clone https://github.com/YOUR_USERNAME/Leelo.git
cd Leelo
npm install
npm run build
npm run bundle
```

## License

MIT