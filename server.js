// server.js - Node.js server using STON.fi SDK
const express = require('express');
const { StonApiClient } = require('@ston-fi/api');
const cors = require('cors');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Initialize STON.fi API client
const client = new StonApiClient();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Cache for storing non-price data only
let cache = {
  assets: null,
  pools: null,
  lastUpdated: null
};

const CACHE_DURATION = 60000; // 1 minute for assets/pools metadata only

// Helper function to check if cache is valid
function isCacheValid() {
  return cache.lastUpdated && (Date.now() - cache.lastUpdated) < CACHE_DURATION;
}

// Helper function to format price
function formatPrice(price) {
  if (price === 0) return '0.00';
  if (price < 0.000001) return price.toExponential(2);
  if (price < 0.01) return price.toFixed(6);
  if (price < 1) return price.toFixed(4);
  if (price < 100) return price.toFixed(2);
  return price.toFixed(0);
}

// Helper function to calculate trading pairs from pools and assets
function calculateTradingPairs(assets, pools) {
  console.log('Processing assets:', assets ? assets.length : 0);
  console.log('Processing pools:', pools ? pools.length : 0);
  
  // Create asset map for quick lookup using contractAddress
  const assetMap = {};
  assets.forEach(asset => {
    if (asset.contractAddress) {
      assetMap[asset.contractAddress] = asset;
    }
  });

  console.log('Created asset map with', Object.keys(assetMap).length, 'entries');

  const pairs = [];

  pools.forEach((pool, index) => {
    // Use the correct property names from the actual API response
    const token0Address = pool.token0Address;
    const token1Address = pool.token1Address;
    const poolAddress = pool.address;
    
    if (token0Address && token1Address && poolAddress) {
      const token0 = assetMap[token0Address];
      const token1 = assetMap[token1Address];
      
      if (token0 && token1) {
        // Use the correct property names for reserves (reserve0, reserve1)
        const token0Reserve = parseFloat(pool.reserve0 || '0');
        const token1Reserve = parseFloat(pool.reserve1 || '0');
        
        // Calculate price using USD prices if available for better accuracy
        let price = 0;
        const token0UsdPrice = parseFloat(token0.dexUsdPrice || '0');
        const token1UsdPrice = parseFloat(token1.dexUsdPrice || '0');
        
        if (token0UsdPrice > 0 && token1UsdPrice > 0) {
          // Use USD prices for more accurate pricing
          price = token1UsdPrice / token0UsdPrice;
        } else if (token0Reserve > 0) {
          // Fallback to reserve-based calculation
          price = token1Reserve / token0Reserve;
          
          // Adjust for decimals
          const token0Decimals = parseInt(token0.decimals || '9');
          const token1Decimals = parseInt(token1.decimals || '9');
          price = price * Math.pow(10, token0Decimals - token1Decimals);
        }

        const pair = {
          id: poolAddress,
          name: `${token0.symbol}/${token1.symbol}`,
          token0: {
            symbol: token0.symbol,
            name: token0.displayName || token0.symbol,
            address: token0.contractAddress,
            decimals: token0.decimals,
            usdPrice: token0UsdPrice
          },
          token1: {
            symbol: token1.symbol,
            name: token1.displayName || token1.symbol,
            address: token1.contractAddress,
            decimals: token1.decimals,
            usdPrice: token1UsdPrice
          },
          price: price,
          formattedPrice: formatPrice(price),
          liquidity: parseFloat(pool.lpTotalSupplyUsd || pool.lpTotalSupply || '0'),
          volume24h: parseFloat(pool.volume24hUsd || '0'),
          apy: parseFloat(pool.apy1D || '0'),
          poolAddress: poolAddress,
          reserves: {
            token0: token0Reserve,
            token1: token1Reserve
          },
          popularityIndex: parseFloat(pool.popularityIndex || '0')
        };
        
        pairs.push(pair);
        
        if (index < 5) { // Log first 5 pairs for debugging
          console.log(`Pair ${index + 1}:`, pair.name, 'Price:', pair.formattedPrice, 'Liquidity:', pair.liquidity);
        }
      } else {
        if (index < 5) { // Log missing tokens for first 5 pools
          console.log(`Pool ${index + 1}: Missing tokens. Token0: ${!!token0} (${token0Address}), Token1: ${!!token1} (${token1Address})`);
        }
      }
    } else {
      if (index < 5) {
        console.log(`Pool ${index + 1}: Missing addresses. Pool: ${!!poolAddress}, Token0: ${!!token0Address}, Token1: ${!!token1Address}`);
      }
    }
  });

  console.log('Generated', pairs.length, 'trading pairs');
  
  // Sort by liquidity (highest first), then by popularity
  return pairs.sort((a, b) => {
    if (b.liquidity !== a.liquidity) {
      return b.liquidity - a.liquidity;
    }
    return b.popularityIndex - a.popularityIndex;
  });
}

// API Routes

// Get all trading pairs with pagination and search (always fresh prices)
app.get('/api/pairs', async (req, res) => {
  try {
    // Get query parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const search = req.query.search || '';
    const sortBy = req.query.sortBy || 'liquidity';
    const sortOrder = req.query.sortOrder || 'desc';
    const minLiquidity = parseFloat(req.query.minLiquidity) || 0;
    const category = req.query.category || 'all';

    console.log('🔄 Fetching fresh price data from STON.fi...');
    
    // Always fetch fresh data for accurate prices - no caching for price data
    const [assets, pools] = await Promise.all([
      client.getAssets(),
      client.getPools()
    ]);

    console.log('✅ Received fresh data:');
    console.log('Assets count:', Array.isArray(assets) ? assets.length : 'Not an array');
    console.log('Pools count:', Array.isArray(pools) ? pools.length : 'Not an array');

    // Calculate trading pairs with fresh price data
    const pairs = calculateTradingPairs(assets, pools);

    // Apply filters and pagination to fresh data
    const filteredPairs = filterAndSortPairs(pairs, {
      search,
      sortBy,
      sortOrder,
      minLiquidity,
      category
    });

    const paginatedResult = paginateResults(filteredPairs, page, limit);

    res.json({
      success: true,
      data: paginatedResult.data,
      pagination: paginatedResult.pagination,
      filters: { search, sortBy, sortOrder, minLiquidity, category },
      cached: false, // Always fresh
      totalPairs: pairs.length,
      lastUpdated: Date.now(),
      priceDataFresh: true
    });

  } catch (error) {
    console.error('Error fetching pairs:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to fetch trading pairs from STON.fi'
    });
  }
});

// Helper function to filter and sort pairs
function filterAndSortPairs(pairs, filters) {
  let filtered = [...pairs];

  // Apply search filter
  if (filters.search) {
    const searchTerm = filters.search.toLowerCase();
    filtered = filtered.filter(pair => 
      pair.name.toLowerCase().includes(searchTerm) ||
      pair.token0.symbol.toLowerCase().includes(searchTerm) ||
      pair.token1.symbol.toLowerCase().includes(searchTerm) ||
      pair.token0.name.toLowerCase().includes(searchTerm) ||
      pair.token1.name.toLowerCase().includes(searchTerm) ||
      pair.poolAddress.toLowerCase().includes(searchTerm)
    );
  }

  // Apply liquidity filter
  if (filters.minLiquidity > 0) {
    filtered = filtered.filter(pair => pair.liquidity >= filters.minLiquidity);
  }

  // Apply category filter
  if (filters.category !== 'all') {
    filtered = filtered.filter(pair => {
      const symbols = [pair.token0.symbol, pair.token1.symbol].join('').toLowerCase();
      const names = [pair.token0.name, pair.token1.name].join('').toLowerCase();
      
      switch (filters.category) {
        case 'stablecoins':
          return symbols.includes('usdt') || symbols.includes('usd') || symbols.includes('usdc') || 
                 symbols.includes('dai') || symbols.includes('busd') || symbols.includes('tusd') ||
                 names.includes('tether') || names.includes('usd coin');
        
        case 'meme':
          // Based on popular TON meme coins and general meme patterns
          return symbols.includes('not') || symbols.includes('notcoin') ||  // Notcoin
                 symbols.includes('hmstr') || symbols.includes('hamster') || // Hamster Kombat
                 symbols.includes('dogs') || symbols.includes('dog') ||      // Dogs
                 symbols.includes('fish') || symbols.includes('tpet') ||     // TON FISH ecosystem
                 symbols.includes('doge') || symbols.includes('shib') ||     // Classic memes
                 symbols.includes('pepe') || symbols.includes('wojak') ||
                 symbols.includes('cat') || symbols.includes('duck') ||      // Animal memes
                 symbols.includes('frog') || symbols.includes('bear') ||
                 symbols.includes('meme') || symbols.includes('moon') ||     // Direct meme references
                 symbols.includes('inu') || symbols.includes('floki') ||     // Dog-themed
                 symbols.includes('elon') || symbols.includes('baby') ||     // Popular meme patterns
                 symbols.includes('safe') || symbols.includes('rocket') ||
                 names.includes('meme') || names.includes('dog') ||
                 names.includes('cat') || names.includes('fish') ||
                 names.includes('hamster') || names.includes('notcoin');
        
        case 'defi':
          return symbols.includes('ton') || symbols.includes('ston') ||     // TON ecosystem
                 symbols.includes('hton') || symbols.includes('tston') ||    // Staked TON variants
                 symbols.includes('uni') || symbols.includes('cake') ||      // DEX tokens
                 symbols.includes('aave') || symbols.includes('comp') ||     // Lending
                 symbols.includes('curve') || symbols.includes('bal') ||     // AMM/DEX
                 symbols.includes('sushi') || symbols.includes('1inch') ||   // DEX aggregators
                 symbols.includes('dedust') || symbols.includes('storm') ||  // TON DeFi
                 symbols.includes('lp') || symbols.includes('pool') ||       // LP tokens
                 names.includes('defi') || names.includes('staked') ||
                 names.includes('liquid') || names.includes('vault');
        
        default:
          return true;
      }
    });
  }

  // Apply sorting
  filtered.sort((a, b) => {
    let comparison = 0;
    
    switch (filters.sortBy) {
      case 'liquidity':
        comparison = b.liquidity - a.liquidity;
        break;
      case 'volume':
        comparison = b.volume24h - a.volume24h;
        break;
      case 'apy':
        comparison = b.apy - a.apy;
        break;
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'price':
        comparison = b.price - a.price;
        break;
      default:
        comparison = b.liquidity - a.liquidity;
    }

    return filters.sortOrder === 'asc' ? -comparison : comparison;
  });

  return filtered;
}

// Helper function to paginate results
function paginateResults(data, page, limit) {
  const totalItems = data.length;
  const totalPages = Math.ceil(totalItems / limit);
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;
  
  const paginatedData = data.slice(startIndex, endIndex);

  return {
    data: paginatedData,
    pagination: {
      currentPage: page,
      totalPages: totalPages,
      totalItems: totalItems,
      itemsPerPage: limit,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      startIndex: startIndex + 1,
      endIndex: Math.min(endIndex, totalItems)
    }
  };
}

// Get specific pair by pool address
app.get('/api/pairs/:poolAddress', async (req, res) => {
  try {
    const { poolAddress } = req.params;
    
    // Get fresh data if not cached
    if (!isCacheValid() || !cache.pairs) {
      const [assets, pools] = await Promise.all([
        client.getAssets(),
        client.getPools()
      ]);
      
      cache.pairs = calculateTradingPairs(assets.asset_list || assets, pools.pool_list || pools);
      cache.lastUpdated = Date.now();
    }

    const pair = cache.pairs.find(p => p.poolAddress === poolAddress);
    
    if (!pair) {
      return res.status(404).json({
        success: false,
        error: 'Pool not found',
        message: `No trading pair found for pool address: ${poolAddress}`
      });
    }

    res.json({
      success: true,
      data: pair,
      lastUpdated: cache.lastUpdated
    });

  } catch (error) {
    console.error('Error fetching specific pair:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Search pairs by symbol or name
app.get('/api/pairs/search/:query', async (req, res) => {
  try {
    const { query } = req.params;
    const searchTerm = query.toLowerCase();
    
    // Get fresh data if not cached
    if (!isCacheValid() || !cache.pairs) {
      const [assets, pools] = await Promise.all([
        client.getAssets(),
        client.getPools()
      ]);
      
      cache.pairs = calculateTradingPairs(assets.asset_list || assets, pools.pool_list || pools);
      cache.lastUpdated = Date.now();
    }

    const filteredPairs = cache.pairs.filter(pair => 
      pair.name.toLowerCase().includes(searchTerm) ||
      pair.token0.symbol.toLowerCase().includes(searchTerm) ||
      pair.token1.symbol.toLowerCase().includes(searchTerm) ||
      pair.token0.name.toLowerCase().includes(searchTerm) ||
      pair.token1.name.toLowerCase().includes(searchTerm)
    );

    res.json({
      success: true,
      data: filteredPairs,
      query: query,
      totalResults: filteredPairs.length,
      lastUpdated: cache.lastUpdated
    });

  } catch (error) {
    console.error('Error searching pairs:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Simulate swap
app.post('/api/simulate-swap', async (req, res) => {
  try {
    const { tokenAAddress, tokenBAddress, amountIn, slippageTolerance = '0.001' } = req.body;
    
    if (!tokenAAddress || !tokenBAddress || !amountIn) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: tokenAAddress, tokenBAddress, amountIn'
      });
    }

    const simulation = await client.simulateSwap({
      tokenA: tokenAAddress,
      tokenB: tokenBAddress,
      units: amountIn,
      slippageTolerance: slippageTolerance
    });

    res.json({
      success: true,
      data: simulation
    });

  } catch (error) {
    console.error('Error simulating swap:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to simulate swap'
    });
  }
});

// Get assets
app.get('/api/assets', async (req, res) => {
  try {
    if (isCacheValid() && cache.assets) {
      return res.json({
        success: true,
        data: cache.assets,
        cached: true
      });
    }

    const assets = await client.getAssets();
    cache.assets = assets;
    
    if (!cache.lastUpdated) {
      cache.lastUpdated = Date.now();
    }

    res.json({
      success: true,
      data: cache.assets,
      cached: false,
      totalAssets: cache.assets.length
    });

  } catch (error) {
    console.error('Error fetching assets:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get pools
app.get('/api/pools', async (req, res) => {
  try {
    if (isCacheValid() && cache.pools) {
      return res.json({
        success: true,
        data: cache.pools,
        cached: true
      });
    }

    const pools = await client.getPools();
    cache.pools = pools;
    
    if (!cache.lastUpdated) {
      cache.lastUpdated = Date.now();
    }

    res.json({
      success: true,
      data: cache.pools,
      cached: false,
      totalPools: cache.pools.length
    });

  } catch (error) {
    console.error('Error fetching pools:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Health check (updated for no price caching)
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'STON.fi API server is running - Always fresh price data',
    timestamp: new Date().toISOString(),
    cache: {
      priceDataCached: false, // Always fresh
      assetsMetadataCached: isCacheValid(),
      lastMetadataUpdate: cache.lastUpdated
    }
  });
});

// Serve the frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: error.message
  });
});

// Start server
app.listen(port, () => {
  console.log(` STON.fi API server running on http://localhost:${port}`);
  console.log(`📊 API endpoints:`);
  console.log(`   GET  /api/pairs                    - Get all trading pairs`);
  console.log(`   GET  /api/pairs/:poolAddress       - Get specific pair`);
  console.log(`   GET  /api/pairs/search/:query      - Search pairs`);
  console.log(`   POST /api/simulate-swap            - Simulate swap`);
  console.log(`   GET  /api/assets                   - Get all assets`);
  console.log(`   GET  /api/pools                    - Get all pools`);
  console.log(`   GET  /api/health                   - Health check`);
});

module.exports = app;