module.exports = function override(config, env) {
  // Add webpack watch options for better hot reloading
  if (env === 'development') {
    config.watchOptions = {
      poll: 1000,
      aggregateTimeout: 300,
      ignored: /node_modules/,
    };
  }
  
  return config;
};

