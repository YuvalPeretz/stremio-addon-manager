#!/bin/bash
# Development startup script for Electron app

echo "Starting Stremio Addon Manager in development mode..."
echo ""

# Kill any existing processes on port 3000
echo "Checking for existing processes on port 3000..."
lsof -ti:3000 | xargs kill -9 2>/dev/null || true

# Start Vite dev server in background
echo "Starting Vite dev server..."
npm run dev:renderer > vite.log 2>&1 &
VITE_PID=$!

# Wait for Vite to start
echo "Waiting for Vite to start..."
sleep 3

# Check if Vite is running
if curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo "✓ Vite dev server is running on http://localhost:3000"
else
    echo "✗ Vite dev server failed to start. Check vite.log for errors."
    cat vite.log
    kill $VITE_PID 2>/dev/null
    exit 1
fi

# Set environment for development
export NODE_ENV=development

# Start Electron
echo "Starting Electron..."
npm start

# Cleanup on exit
echo ""
echo "Shutting down..."
kill $VITE_PID 2>/dev/null

