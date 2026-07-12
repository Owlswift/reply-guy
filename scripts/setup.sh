#!/bin/bash

# Echo Setup Script
# This script helps set up the prerequisites for running Echo

echo "=== Echo Setup ==="
echo ""

# Check if Chrome is already running with remote debugging
if curl -s http://127.0.0.1:9222/json/version > /dev/null 2>&1; then
    echo "✓ Chrome is already running with remote debugging on port 9222"
else
    echo "1. Chrome with remote debugging is required"
    echo "   Run this command in another terminal:"
    echo "   /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug-profile"
    echo ""
fi

# Start Ollama server
echo "2. Starting Ollama server..."
if command -v ollama &> /dev/null; then
    # Check if ollama is already running
    if curl -s http://127.0.0.1:11434/api/tags > /dev/null 2>&1; then
        echo "   ✓ Ollama server is already running"
    else
        ollama serve &
        sleep 1
        echo "   Ollama server started in background"
    fi
else
    echo "   ✗ Ollama not found. Please install it from https://ollama.com"
fi
echo ""

echo "3. Make sure you have the gpt-oss:20b model:"
echo "   ollama run gpt-oss:20b"
echo ""

echo "=== Setup complete ==="
echo "Then run: npm run start:runner"
