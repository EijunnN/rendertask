#!/bin/bash

# Modern Chat Deployment Script for Render
# This script prepares the application for deployment

echo "🚀 Preparing Modern Chat for deployment..."

# Check if Bun is installed
if ! command -v bun &> /dev/null; then
    echo "❌ Bun is not installed. Please install Bun first:"
    echo "curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

echo "✅ Bun is installed"

# Install dependencies
echo "📦 Installing dependencies..."
bun install

# Test the application locally
echo "🧪 Testing application locally..."
echo "Starting server on port 3000..."
echo "Visit http://localhost:3000 to test the chat application"
echo "Press Ctrl+C to stop the server"

# Start the development server
bun run dev