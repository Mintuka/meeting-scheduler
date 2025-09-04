#!/bin/bash
# Development script with hot reloading configuration

export FAST_REFRESH=true
export CHOKIDAR_USEPOLLING=true
export CHOKIDAR_INTERVAL=1000

# Start the development server
npm start

