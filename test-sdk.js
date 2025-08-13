// test-sdk.js - Simple test to verify STON.fi SDK
const { StonApiClient } = require('@ston-fi/api');

async function testStonFiSdk() {
    console.log('🔍 Testing STON.fi SDK...');
    
    try {
        const client = new StonApiClient();
        
        console.log('📡 Fetching assets...');
        const assetsResponse = await client.getAssets();
        console.log('✅ Assets response structure:', Object.keys(assetsResponse));
        
        const assets = assetsResponse.asset_list || assetsResponse;
        console.log('📊 Assets count:', Array.isArray(assets) ? assets.length : 'Not an array');
        
        if (Array.isArray(assets) && assets.length > 0) {
            console.log('🔍 Sample asset structure:', Object.keys(assets[0]));
            console.log('🪙 First few assets:');
            assets.slice(0, 3).forEach((asset, i) => {
                console.log(`  ${i + 1}. ${asset.symbol} (${asset.displayName || asset.display_name})`);
                console.log(`     Address: ${asset.contractAddress || asset.contract_address}`);
                console.log(`     USD Price: $${asset.dexUsdPrice || asset.dexPriceUsd || 'N/A'}`);
            });
        }
        
        console.log('\n🏊 Fetching pools...');
        const poolsResponse = await client.getPools();
        console.log('✅ Pools response structure:', Object.keys(poolsResponse));
        
        const pools = poolsResponse.pool_list || poolsResponse;
        console.log('📊 Pools count:', Array.isArray(pools) ? pools.length : 'Not an array');
        
        if (Array.isArray(pools) && pools.length > 0) {
            console.log('🔍 Sample pool structure:', Object.keys(pools[0]));
            console.log('💧 First few pools:');
            pools.slice(0, 3).forEach((pool, i) => {
                console.log(`  ${i + 1}. Pool Address: ${pool.address || pool.poolAddress || 'N/A'}`);
                console.log(`     Token0: ${pool.token0Address || pool.token0_address || 'N/A'}`);
                console.log(`     Token1: ${pool.token1Address || pool.token1_address || 'N/A'}`);
                console.log(`     Liquidity: ${pool.lpTotalSupply || pool.lp_total_supply || 'N/A'}`);
            });
        }
        
        // Test specific pair lookup
        console.log('\n🔄 Testing specific pair...');
        try {
            const pairPools = await client.getPoolsByAssetPair({
                asset0Address: "EQCymLRXp1QYxZKek4CTInckB1ey5TkyAJQpPAlNetiO54Vt", // TON
                asset1Address: "EQBgI-rl6SzhJp5Rtoqg0JlWsgPH4rnVkU6EAnD1yvOuzMPG", // SW
            });
            console.log('✅ Specific pair found:', pairPools);
        } catch (error) {
            console.log('❌ Specific pair error:', error.message);
        }
        
        console.log('\n🎉 SDK test completed successfully!');
        return { assets, pools };
        
    } catch (error) {
        console.error('❌ SDK test failed:', error.message);
        console.error('📋 Full error:', error);
        throw error;
    }
}

// Run the test
if (require.main === module) {
    testStonFiSdk()
        .then(() => {
            console.log('\n✅ All tests passed!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Test failed:', error.message);
            process.exit(1);
        });
}

module.exports = { testStonFiSdk };